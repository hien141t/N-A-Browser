param(
    [int]$targetPid,
    [string]$icoPath
)

$code = @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class Win32WindowIcon {
    [DllImport("user32.dll")]
    public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll", SetLastError=true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern IntPtr LoadImage(IntPtr hinst, string lpszName, uint uType, int cxDesired, int cyDesired, uint fuLoad);

    public static int Apply(int targetPid, string icoPath) {
        IntPtr hIconBig = LoadImage(IntPtr.Zero, icoPath, 1, 32, 32, 0x00000010);
        IntPtr hIconSmall = LoadImage(IntPtr.Zero, icoPath, 1, 16, 16, 0x00000010);
        if (hIconBig == IntPtr.Zero && hIconSmall == IntPtr.Zero) return 0;

        int count = 0;
        EnumWindows((hWnd, lParam) => {
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            if (pid == targetPid) {
                StringBuilder sb = new StringBuilder(256);
                GetClassName(hWnd, sb, 256);
                string cls = sb.ToString();
                if (cls.Contains("Chrome_WidgetWin")) {
                    SendMessage(hWnd, 0x0080, (IntPtr)0, hIconSmall);
                    SendMessage(hWnd, 0x0080, (IntPtr)1, hIconBig);
                    count++;
                }
            }
            return true;
        }, IntPtr.Zero);
        return count;
    }
}
"@

try {
    Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue
} catch {}

for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Milliseconds 300
    try {
        $applied = [Win32WindowIcon]::Apply($targetPid, $icoPath)
        if ($applied -gt 0) { break }
    } catch {}
}
