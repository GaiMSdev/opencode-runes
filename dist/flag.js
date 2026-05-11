import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const VALID_MODES = ["lite", "full", "ultra", "wenyan", "off"];
const MAX_FLAG_BYTES = 64;
export function flagPath() {
    const base = process.env["OPENCODE_CONFIG_DIR"] ??
        path.join(os.homedir(), ".config", "opencode");
    return path.join(base, ".runes-active");
}
export function resolveDirSafe(dirPath) {
    try {
        const lstat = fs.lstatSync(dirPath);
        if (lstat.isSymbolicLink()) {
            const real = fs.realpathSync(dirPath);
            const stat = fs.statSync(real);
            if (!stat.isDirectory())
                return null;
            if (typeof process.getuid === "function") {
                if (stat.uid !== process.getuid())
                    return null;
            }
            else {
                const home = path.resolve(os.homedir());
                const resolved = path.resolve(real);
                if (!resolved.toLowerCase().startsWith(home.toLowerCase() + path.sep) &&
                    resolved.toLowerCase() !== home.toLowerCase())
                    return null;
            }
            return real;
        }
        return dirPath;
    }
    catch {
        return null;
    }
}
function safeReadFile(filePath) {
    try {
        const st = fs.lstatSync(filePath);
        if (st.isSymbolicLink() || !st.isFile())
            return null;
        if (st.size > MAX_FLAG_BYTES)
            return null;
        const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
        const flags = fs.constants.O_RDONLY | O_NOFOLLOW;
        let fd;
        try {
            fd = fs.openSync(filePath, flags);
            const buf = Buffer.alloc(MAX_FLAG_BYTES);
            const n = fs.readSync(fd, buf, 0, MAX_FLAG_BYTES, 0);
            return buf.slice(0, n).toString("utf8");
        }
        finally {
            if (fd !== undefined)
                fs.closeSync(fd);
        }
    }
    catch {
        return null;
    }
}
function safeWriteFile(filePath, content) {
    try {
        const dir = path.dirname(filePath);
        fs.mkdirSync(dir, { recursive: true });
        const realDir = resolveDirSafe(dir);
        if (!realDir)
            return;
        const realPath = path.join(realDir, path.basename(filePath));
        try {
            if (fs.lstatSync(realPath).isSymbolicLink())
                return;
        }
        catch (e) {
            const nodeErr = e;
            if (nodeErr.code !== "ENOENT")
                return;
        }
        const tempPath = path.join(realDir, `.runes-active.${process.pid}.${Date.now()}`);
        const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
        const wFlags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW;
        let fd;
        try {
            fd = fs.openSync(tempPath, wFlags, 0o600);
            fs.writeSync(fd, content);
            try {
                fs.fchmodSync(fd, 0o600);
            }
            catch { /* best-effort */ }
        }
        finally {
            if (fd !== undefined)
                fs.closeSync(fd);
        }
        fs.renameSync(tempPath, realPath);
    }
    catch {
        /* best-effort */
    }
}
export function readFlag() {
    const raw = safeReadFile(flagPath());
    if (!raw)
        return null;
    const val = raw.trim().toLowerCase();
    return VALID_MODES.includes(val) ? val : null;
}
export function writeFlag(mode) {
    safeWriteFile(flagPath(), mode);
}
export function removeFlag() {
    const fp = flagPath();
    try {
        const st = fs.lstatSync(fp);
        if (st.isSymbolicLink() || !st.isFile())
            return;
        fs.unlinkSync(fp);
    }
    catch {
        /* best-effort */
    }
}
export function isActive() {
    const m = readFlag();
    return m !== null && m !== "off";
}
//# sourceMappingURL=flag.js.map