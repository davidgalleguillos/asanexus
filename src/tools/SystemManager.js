import { exec } from "child_process";
import screenshot from "screenshot-desktop";

export class SystemManager {
    constructor() {
        this.MOUSE_DEF = 'using System.Runtime.InteropServices; public class Mouse { [DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int x, int y); [DllImport(\"user32.dll\")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, int e); }';
        this.WIN_DEF = 'using System; using System.Runtime.InteropServices; using System.Text; public class Win { [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count); }';
        this.SEND_KEYS = 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait';
    }

    // [v6.1] Whitelist Masiva de prefijos de comandos (Aceleración de Desarrollo)
    static SAFE_PREFIXES = [
        'powershell', 'pwsh',
        // PowerShell Verbs (Standard)
        'get-', 'set-', 'new-', 'remove-', 'copy-', 'move-', 'invoke-', 'start-', 'stop-', 'restart-',
        'enable-', 'disable-', 'import-', 'export-', 'add-', 'clear-', 'write-', 'read-', 'test-', 'wait-',
        'push-', 'pop-', 'compress-', 'expand-', 'select-', 'where-', 'sort-', 'group-', 'measure-',
        // Dev Tooling & Package Managers
        'npm', 'npx', 'node', 'yarn', 'pnpm', 'pip', 'pip3', 'python', 'py', 'python3', 'venv', 'conda',
        'git', 'gh', 'ghr', 'tsc', 'eslint', 'prettier', 'vite', 'next', 'curl', 'wget', 'ssh', 'scp',
        // System Admin & Networking
        'tasklist', 'taskkill', 'netstat', 'ipconfig', 'hostname', 'whoami', 'systeminfo', 'ping', 'tracert',
        'nslookup', 'arp', 'net', 'sc', 'reg', 'attrib', 'chkdsk', 'sfc', 'assoc', 'ftype',
        // File & Directory Operations (Native)
        'dir', 'ls', 'type', 'cat', 'echo', 'mkdir', 'rm', 'mv', 'cp', 'cd', 'touch', 'cls', 'clear', 
        'exit', 'find', 'findstr', 'sort', 'more', 'attrib', 'icacls', 'takeown',
        // Common Archivers
        'tar', '7z', 'zip', 'unzip', 'expand-archive', 'compress-archive',
        '#'
    ];

    async run(cmd, timeoutMs = 60000) {
        // Validar contra whitelist
        const cmdLower = cmd.toLowerCase().trim();
        const isSafe = SystemManager.SAFE_PREFIXES.some(p => cmdLower.startsWith(p));
        if (!isSafe) {
            const blocked = `⛔ BLOQUEADO: Comando "${cmd.split(' ')[0]}" no está en la whitelist de seguridad.`;
            console.warn(`[SECURITY] ${blocked}`);
            return blocked;
        }
        return new Promise((resolve) => {
            const t = setTimeout(() => resolve(`Error: Timeout (${timeoutMs}ms).`), timeoutMs);
            exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
                clearTimeout(t);
                if (err) resolve(`Error: ${err.message}\nStderr: ${stderr}`);
                resolve(stdout || "OK");
            });
        });
    }

    async winApi(cSharp, ps) {
        return this.run(`powershell -Command "Add-Type -TypeDefinition '${cSharp}'; ${ps}"`);
    }

    async measureLatency(host = "api.anthropic.com") {
        try {
            const start = Date.now();
            await this.run(`powershell -Command "Test-Connection -ComputerName ${host} -Count 1"`);
            return `Latencia con ${host}: ${Date.now() - start}ms`;
        } catch (e) {
            return `ERROR de red: ${e.message}`;
        }
    }

    async computerAction(action, { coordinate: [x, y] = [0, 0], text, key, monitor = 0 } = {}) {
        switch (action) {
            case "screenshot": 
                const buf = await screenshot();
                return buf.toString("base64");
            case "get_active_window":
                return this.winApi(this.WIN_DEF, '$h=[Win]::GetForegroundWindow(); $t=New-Object System.Text.StringBuilder 256; [void][Win]::GetWindowText($h, $t, 256); $t.ToString()');
            case "get_screen_info":
                return this.run('powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width.ToString() + \'x\' + [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height.ToString()"');
            case "mouse_move": 
                return this.winApi(this.MOUSE_DEF, `[Mouse]::SetCursorPos(${x}, ${y})`);
            case "left_click": 
                return this.winApi(this.MOUSE_DEF, `[Mouse]::mouse_event(0x0002 | 0x0004, 0, 0, 0, 0)`);
            case "type": 
                const safeText = text.replace(/'/g, "''");
                return this.run(`powershell -Command "${this.SEND_KEYS}('${safeText}')"`);
            case "key":  
                if (!/^[a-zA-Z0-9]+$/.test(key)) return "Error: Key no válida (solo alfanuméricos).";
                return this.run(`powershell -Command "${this.SEND_KEYS}('{${key}}')"`);
            default: return "Acción no soportada.";
        }
    }
}
