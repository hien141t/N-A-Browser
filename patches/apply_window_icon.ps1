param(
    [int]$targetPid,
    [string]$icoPath,
    [string]$appId = ""
)

$code = @"
using System;
using System.Runtime.InteropServices;
using System.Text;

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct PROPERTYKEY {
    public Guid fmtid;
    public uint pid;
    public PROPERTYKEY(Guid g, uint p) { fmtid = g; pid = p; }
}

[StructLayout(LayoutKind.Explicit)]
public struct PROPVARIANT {
    [FieldOffset(0)] public ushort vt;
    [FieldOffset(8)] public IntPtr pwszVal;
}

[ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPropertyStore {
    int GetCount(out uint cProps);
    int GetAt(uint iProp, out PROPERTYKEY pkey);
    int GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
    int SetValue(ref PROPERTYKEY key, ref PROPVARIANT pv);
    int Commit();
}

public class Win32WindowIcon {
    [DllImport("user32.dll")]
    public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern IntPtr LoadImage(IntPtr hinst, string lpszName, uint uType, int cxDesired, int cyDesired, uint fuLoad);

    [DllImport("shell32.dll", SetLastError = true)]
    public static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid iid, out IPropertyStore propertyStore);

    private static Guid IID_IPropertyStore = new Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99");
    private static PROPERTYKEY PKEY_AppUserModel_ID = new PROPERTYKEY(new Guid("9F4C2855-9F79-48A1-92B3-8D642D778E42"), 5);
    private static PROPERTYKEY PKEY_AppUserModel_RelaunchIconResource = new PROPERTYKEY(new Guid("9F4C2855-9F79-48A1-92B3-8D642D778E42"), 2);

    public static int Apply(int targetPid, string icoPath, string appId) {
        IntPtr hIconBig = LoadImage(IntPtr.Zero, icoPath, 1, 32, 32, 0x00000010);
        IntPtr hIconSmall = LoadImage(IntPtr.Zero, icoPath, 1, 16, 16, 0x00000010);

        int count = 0;
        EnumWindows((hWnd, lParam) => {
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            if (pid == targetPid) {
                StringBuilder sb = new StringBuilder(256);
                GetClassName(hWnd, sb, 256);
                string cls = sb.ToString();
                if (cls.Contains("Chrome_WidgetWin")) {
                    if (hIconSmall != IntPtr.Zero) SendMessage(hWnd, 0x0080, (IntPtr)0, hIconSmall);
                    if (hIconBig != IntPtr.Zero) SendMessage(hWnd, 0x0080, (IntPtr)1, hIconBig);

                    try {
                        IPropertyStore store;
                        if (SHGetPropertyStoreForWindow(hWnd, ref IID_IPropertyStore, out store) == 0 && store != null) {
                            if (!string.IsNullOrEmpty(appId)) {
                                PROPVARIANT pvAppId = new PROPVARIANT();
                                pvAppId.vt = 31; // VT_LPWSTR
                                pvAppId.pwszVal = Marshal.StringToCoTaskMemUni(appId);
                                store.SetValue(ref PKEY_AppUserModel_ID, ref pvAppId);
                                Marshal.FreeCoTaskMem(pvAppId.pwszVal);
                            }
                            if (!string.IsNullOrEmpty(icoPath)) {
                                PROPVARIANT pvIcon = new PROPVARIANT();
                                pvIcon.vt = 31; // VT_LPWSTR
                                pvIcon.pwszVal = Marshal.StringToCoTaskMemUni(icoPath + ",0");
                                store.SetValue(ref PKEY_AppUserModel_RelaunchIconResource, ref pvIcon);
                                Marshal.FreeCoTaskMem(pvIcon.pwszVal);
                            }
                            store.Commit();
                        }
                    } catch {}

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

for ($i = 0; $i -lt 25; $i++) {
    Start-Sleep -Milliseconds 300
    try {
        $applied = [Win32WindowIcon]::Apply($targetPid, $icoPath, $appId)
        if ($applied -gt 0) { break }
    } catch {}
}
