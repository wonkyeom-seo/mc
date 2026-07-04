const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const MAX_TEXT_FILE_SIZE = 2 * 1024 * 1024;

function fileVersion(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

class ServerFileStore {
  constructor(rootDir) {
    this.rootDir = path.resolve(rootDir);
  }

  async init() {
    await fs.mkdir(this.rootDir, { recursive: true });
  }

  normalize(relativePath = '') {
    if (typeof relativePath !== 'string' || relativePath.includes('\0')) {
      throw this.error('올바르지 않은 경로입니다.', 400);
    }

    const normalizedInput = relativePath.replaceAll('\\', '/').replace(/^\/+/, '');
    const absolutePath = path.resolve(this.rootDir, normalizedInput);
    const relative = path.relative(this.rootDir, absolutePath);

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw this.error('서버 폴더 밖의 경로에는 접근할 수 없습니다.', 403);
    }

    return {
      absolutePath,
      relativePath: relative.split(path.sep).join('/'),
    };
  }

  async assertNoSymlinks(absolutePath) {
    const relative = path.relative(this.rootDir, absolutePath);
    const parts = relative ? relative.split(path.sep) : [];
    let current = this.rootDir;

    for (const part of parts) {
      current = path.join(current, part);
      try {
        const stat = await fs.lstat(current);
        if (stat.isSymbolicLink()) {
          throw this.error('심볼릭 링크에는 접근할 수 없습니다.', 403);
        }
      } catch (error) {
        if (error.code === 'ENOENT') break;
        throw error;
      }
    }
  }

  async list(relativePath = '') {
    const target = this.normalize(relativePath);
    await this.assertNoSymlinks(target.absolutePath);

    let entries;
    try {
      entries = await fs.readdir(target.absolutePath, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') throw this.error('폴더를 찾을 수 없습니다.', 404);
      if (error.code === 'ENOTDIR') throw this.error('폴더 경로가 아닙니다.', 400);
      throw error;
    }

    const items = await Promise.all(entries.slice(0, 1_000).map(async (entry) => {
      const absoluteEntry = path.join(target.absolutePath, entry.name);
      const stat = await fs.lstat(absoluteEntry);
      return {
        name: entry.name,
        path: path.posix.join(target.relativePath, entry.name),
        type: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'file',
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    }));

    return items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name, 'ko', { numeric: true });
    });
  }

  async read(relativePath) {
    const target = this.normalize(relativePath);
    await this.assertNoSymlinks(target.absolutePath);

    let stat;
    try {
      stat = await fs.stat(target.absolutePath);
    } catch (error) {
      if (error.code === 'ENOENT') throw this.error('파일을 찾을 수 없습니다.', 404);
      throw error;
    }

    if (!stat.isFile()) throw this.error('파일 경로가 아닙니다.', 400);
    if (stat.size > MAX_TEXT_FILE_SIZE) {
      throw this.error('2MB보다 큰 파일은 웹 편집기에서 열 수 없습니다.', 413);
    }

    const buffer = await fs.readFile(target.absolutePath);
    if (buffer.includes(0)) throw this.error('바이너리 파일은 편집할 수 없습니다.', 415);

    return {
      path: target.relativePath,
      content: buffer.toString('utf8'),
      size: buffer.length,
      modifiedAt: stat.mtime.toISOString(),
      version: fileVersion(buffer),
    };
  }

  async write(relativePath, content, expectedVersion) {
    if (typeof content !== 'string') throw this.error('파일 내용은 문자열이어야 합니다.', 400);
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > MAX_TEXT_FILE_SIZE) throw this.error('2MB보다 큰 파일은 저장할 수 없습니다.', 413);

    const target = this.normalize(relativePath);
    await this.assertNoSymlinks(target.absolutePath);

    let currentBuffer;
    try {
      const stat = await fs.stat(target.absolutePath);
      if (!stat.isFile()) throw this.error('파일 경로가 아닙니다.', 400);
      currentBuffer = await fs.readFile(target.absolutePath);
    } catch (error) {
      if (error.code === 'ENOENT') throw this.error('파일을 찾을 수 없습니다.', 404);
      throw error;
    }

    const currentVersion = fileVersion(currentBuffer);
    if (expectedVersion && expectedVersion !== currentVersion) {
      throw this.error('다른 곳에서 파일이 변경되었습니다. 다시 불러온 뒤 저장하세요.', 409);
    }

    const tempPath = `${target.absolutePath}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, content, 'utf8');
    try {
      await fs.rename(tempPath, target.absolutePath);
    } catch (error) {
      await fs.rm(tempPath, { force: true });
      throw error;
    }

    const buffer = Buffer.from(content, 'utf8');
    return {
      path: target.relativePath,
      size: buffer.length,
      version: fileVersion(buffer),
      modifiedAt: new Date().toISOString(),
    };
  }

  error(message, statusCode) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
  }
}

module.exports = {
  fileVersion,
  MAX_TEXT_FILE_SIZE,
  ServerFileStore,
};
