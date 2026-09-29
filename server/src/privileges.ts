import fs from 'node:fs';
import path from 'node:path';

function lchown(p: string, uid: number, gid: number): boolean {
  try {
    fs.lchownSync(p, uid, gid);
    return true;
  } catch {
    return false;
  }
}

function chownTree(p: string, uid: number, gid: number) {
  if (!lchown(p, uid, gid)) return;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(p, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    // Only walk into real folders: following a symlink could hand files outside /data to PUID.
    if (e.isDirectory()) chownTree(path.join(p, e.name), uid, gid);
    else lchown(path.join(p, e.name), uid, gid);
  }
}

/**
 * When the container starts as root and PUID/PGID are set (Synology: usually
 * 1026/100), hand the data folder to that user and continue as them, so files
 * on the NAS belong to you and your photo library is readable.
 */
export function dropPrivileges(dataDir: string, env = process.env): string | null {
  const { getuid, setgid, setuid, setgroups } = process;
  if (!getuid || !setgid || !setuid || getuid() !== 0) return null; // not POSIX, or not root
  const uid = Number(env.PUID);
  const gid = Number(env.PGID);
  if (!Number.isInteger(uid) || !Number.isInteger(gid) || uid <= 0) return null;
  fs.mkdirSync(dataDir, { recursive: true });
  chownTree(dataDir, uid, gid);
  setgroups?.([gid]);
  setgid(gid);
  setuid(uid);
  return `${uid}:${gid}`;
}
