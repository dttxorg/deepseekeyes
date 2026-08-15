$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.Drawing

$nativeSource = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class DeepSeekEyesNative {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION U; }
    [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }
    [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
        public int dx; public int dy; public uint mouseData; public uint dwFlags;
        public uint time; public UIntPtr dwExtraInfo;
    }
    [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT {
        public ushort wVk; public ushort wScan; public uint dwFlags;
        public uint time; public UIntPtr dwExtraInfo;
    }

    public sealed class WindowInfo {
        public string NativeId;
        public int Pid;
        public string Application;
        public string Title;
        public bool Active;
        public int X;
        public int Y;
        public int Width;
        public int Height;
    }

    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maximum);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("user32.dll")] public static extern short VkKeyScan(char value);
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    public const uint INPUT_KEYBOARD = 1;
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const uint KEYEVENTF_UNICODE = 0x0004;
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    public const uint MOUSEEVENTF_WHEEL = 0x0800;
    public const uint MOUSEEVENTF_HWHEEL = 0x01000;

    public static void EnableDpiAwareness() {
        try {
            if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return;
        } catch { }
        try { SetProcessDPIAware(); } catch { }
    }

    public static WindowInfo[] Windows(int maximum) {
        var found = new List<WindowInfo>();
        IntPtr active = GetForegroundWindow();
        EnumWindows((handle, ignored) => {
            if (found.Count >= maximum || !IsWindowVisible(handle)) return true;
            int length = GetWindowTextLength(handle);
            if (length <= 0) return true;
            var title = new StringBuilder(length + 1);
            GetWindowText(handle, title, title.Capacity);
            uint rawPid;
            GetWindowThreadProcessId(handle, out rawPid);
            RECT rect;
            if (!GetWindowRect(handle, out rect)) return true;
            string application = "unknown";
            try { application = Process.GetProcessById((int)rawPid).ProcessName; } catch { }
            found.Add(new WindowInfo {
                NativeId = handle.ToInt64().ToString(),
                Pid = (int)rawPid,
                Application = application,
                Title = title.ToString(),
                Active = handle == active,
                X = rect.Left,
                Y = rect.Top,
                Width = Math.Max(0, rect.Right - rect.Left),
                Height = Math.Max(0, rect.Bottom - rect.Top),
            });
            return true;
        }, IntPtr.Zero);
        return found.ToArray();
    }

    public static void SendUnicode(string text) {
        var inputs = new List<INPUT>();
        foreach (char character in text) {
            inputs.Add(new INPUT { type = INPUT_KEYBOARD, U = new INPUTUNION { ki = new KEYBDINPUT { wScan = character, dwFlags = KEYEVENTF_UNICODE } } });
            inputs.Add(new INPUT { type = INPUT_KEYBOARD, U = new INPUTUNION { ki = new KEYBDINPUT { wScan = character, dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP } } });
        }
        if (inputs.Count > 0 && SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf(typeof(INPUT))) != (uint)inputs.Count) {
            throw new InvalidOperationException("SendInput did not accept the complete Unicode input");
        }
    }

    public static void SendVirtualKey(ushort key, bool down) {
        var input = new INPUT {
            type = INPUT_KEYBOARD,
            U = new INPUTUNION { ki = new KEYBDINPUT { wVk = key, dwFlags = down ? 0u : KEYEVENTF_KEYUP } }
        };
        if (SendInput(1, new [] { input }, Marshal.SizeOf(typeof(INPUT))) != 1) {
            throw new InvalidOperationException("SendInput virtual key failed");
        }
    }

    public static void Scroll(int vertical, int horizontal) {
        unchecked {
            if (vertical != 0) mouse_event(MOUSEEVENTF_WHEEL, 0, 0, (uint)vertical, UIntPtr.Zero);
            if (horizontal != 0) mouse_event(MOUSEEVENTF_HWHEEL, 0, 0, (uint)horizontal, UIntPtr.Zero);
        }
    }
}
'@

Add-Type -TypeDefinition $nativeSource -Language CSharp
[DeepSeekEyesNative]::EnableDpiAwareness()

function Read-DeepSeekEyesInput {
    $raw = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($raw)) { throw 'desktop helper received empty input' }
    return $raw | ConvertFrom-Json
}

function Get-PropertyValue($Object, [string]$Name, $Default = $null) {
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $Default }
    return $property.Value
}

function Resolve-Window($InputObject) {
    $windows = [DeepSeekEyesNative]::Windows(500)
    $window = Get-PropertyValue $InputObject 'window'
    $nativeId = if ($null -eq $window) { $null } else { Get-PropertyValue $window 'nativeId' }
    $application = [string](Get-PropertyValue $InputObject 'application' '')
    if ([string]::IsNullOrWhiteSpace($application) -and $null -ne $window) { $application = [string](Get-PropertyValue $window 'application' '') }
    $title = [string](Get-PropertyValue $InputObject 'title' '')
    if ([string]::IsNullOrWhiteSpace($title) -and $null -ne $window) { $title = [string](Get-PropertyValue $window 'title' '') }
    foreach ($candidate in $windows) {
        if ($null -ne $nativeId -and $candidate.NativeId -eq [string]$nativeId) { return $candidate }
        if (-not [string]::IsNullOrWhiteSpace($title) -and $candidate.Title.IndexOf($title, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $candidate }
        if (-not [string]::IsNullOrWhiteSpace($application) -and $candidate.Application.IndexOf($application, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $candidate }
    }
    throw 'target Windows application/window was not found'
}

function Convert-ToAbsolutePoint($InputObject, $Screen, [string]$XName, [string]$YName) {
    return @(
        [int]$Screen.X + [int](Get-PropertyValue $InputObject $XName 0),
        [int]$Screen.Y + [int](Get-PropertyValue $InputObject $YName 0)
    )
}

function Send-KeyCombination([string]$Combination) {
    $map = @{
        'CTRL' = 0x11; 'CONTROL' = 0x11; 'SHIFT' = 0x10; 'ALT' = 0x12; 'WIN' = 0x5B; 'META' = 0x5B
        'ENTER' = 0x0D; 'RETURN' = 0x0D; 'TAB' = 0x09; 'SPACE' = 0x20; 'BACKSPACE' = 0x08
        'ESC' = 0x1B; 'ESCAPE' = 0x1B; 'DELETE' = 0x2E; 'LEFT' = 0x25; 'UP' = 0x26
        'RIGHT' = 0x27; 'DOWN' = 0x28; 'HOME' = 0x24; 'END' = 0x23; 'PAGEUP' = 0x21; 'PAGEDOWN' = 0x22
        'F1' = 0x70; 'F2' = 0x71; 'F3' = 0x72; 'F4' = 0x73; 'F5' = 0x74; 'F6' = 0x75
        'F7' = 0x76; 'F8' = 0x77; 'F9' = 0x78; 'F10' = 0x79; 'F11' = 0x7A; 'F12' = 0x7B
    }
    $parts = @($Combination.Split('+') | ForEach-Object { $_.Trim().ToUpperInvariant() } | Where-Object { $_ -ne '' })
    if ($parts.Count -eq 0) { throw 'key combination is empty' }
    $keys = New-Object System.Collections.Generic.List[UInt16]
    foreach ($part in $parts) {
        if ($map.ContainsKey($part)) { $keys.Add([UInt16]$map[$part]); continue }
        if ($part.Length -eq 1) {
            $scan = [DeepSeekEyesNative]::VkKeyScan($part[0])
            if ($scan -eq -1) { throw "unsupported Windows key $part" }
            $keys.Add([UInt16]($scan -band 0xFF))
            continue
        }
        throw "unsupported Windows key $part"
    }
    foreach ($key in $keys) { [DeepSeekEyesNative]::SendVirtualKey($key, $true) }
    for ($index = $keys.Count - 1; $index -ge 0; $index--) { [DeepSeekEyesNative]::SendVirtualKey($keys[$index], $false) }
}

function Capture-Desktop([string]$Path) {
    $x = [DeepSeekEyesNative]::GetSystemMetrics(76)
    $y = [DeepSeekEyesNative]::GetSystemMetrics(77)
    $width = [DeepSeekEyesNative]::GetSystemMetrics(78)
    $height = [DeepSeekEyesNative]::GetSystemMetrics(79)
    if ($width -le 0 -or $height -le 0) {
        $x = 0; $y = 0
        $width = [DeepSeekEyesNative]::GetSystemMetrics(0)
        $height = [DeepSeekEyesNative]::GetSystemMetrics(1)
    }
    $bitmap = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.CopyFromScreen($x, $y, 0, 0, ([System.Drawing.Size]::new($width, $height)), [System.Drawing.CopyPixelOperation]::SourceCopy)
        } finally { $graphics.Dispose() }
        $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $bitmap.Dispose() }
    return [pscustomobject]@{ x = $x; y = $y; width = $width; height = $height; scaleFactor = 1 }
}

function Invoke-Action($InputObject, $Screen) {
    $action = [string]$InputObject.action
    if ($action -in @('observe', 'assert', 'report')) { return [pscustomobject]@{ observed = $true } }
    if ($action -eq 'wait') {
        $duration = [int](Get-PropertyValue $InputObject 'durationMs' 500)
        Start-Sleep -Milliseconds $duration
        return [pscustomobject]@{ waitedMs = $duration }
    }
    if ($action -in @('click', 'double_click', 'right_click', 'move_cursor')) {
        $point = Convert-ToAbsolutePoint $InputObject $Screen 'x' 'y'
        [DeepSeekEyesNative]::SetCursorPos($point[0], $point[1]) | Out-Null
        if ($action -eq 'move_cursor') { return [pscustomobject]@{ moved = $true } }
        $count = if ($action -eq 'double_click') { 2 } else { 1 }
        for ($index = 0; $index -lt $count; $index++) {
            if ($action -eq 'right_click') {
                [DeepSeekEyesNative]::mouse_event([DeepSeekEyesNative]::MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, [UIntPtr]::Zero)
                [DeepSeekEyesNative]::mouse_event([DeepSeekEyesNative]::MOUSEEVENTF_RIGHTUP, 0, 0, 0, [UIntPtr]::Zero)
            } else {
                [DeepSeekEyesNative]::mouse_event([DeepSeekEyesNative]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
                [DeepSeekEyesNative]::mouse_event([DeepSeekEyesNative]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
            }
            if ($count -gt 1) { Start-Sleep -Milliseconds 80 }
        }
        return [pscustomobject]@{ performed = $action }
    }
    if ($action -eq 'drag') {
        $start = Convert-ToAbsolutePoint $InputObject $Screen 'x' 'y'
        $end = Convert-ToAbsolutePoint $InputObject $Screen 'endX' 'endY'
        $duration = [int](Get-PropertyValue $InputObject 'durationMs' 400)
        $steps = [Math]::Max(2, [Math]::Min(120, [Math]::Round($duration / 16)))
        [DeepSeekEyesNative]::SetCursorPos($start[0], $start[1]) | Out-Null
        [DeepSeekEyesNative]::mouse_event([DeepSeekEyesNative]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
        for ($step = 1; $step -le $steps; $step++) {
            $ratio = $step / $steps
            [DeepSeekEyesNative]::SetCursorPos(
                [int]($start[0] + ($end[0] - $start[0]) * $ratio),
                [int]($start[1] + ($end[1] - $start[1]) * $ratio)
            ) | Out-Null
            Start-Sleep -Milliseconds ([Math]::Max(1, [int]($duration / $steps)))
        }
        [DeepSeekEyesNative]::mouse_event([DeepSeekEyesNative]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
        return [pscustomobject]@{ performed = 'drag' }
    }
    if ($action -eq 'type') {
        [DeepSeekEyesNative]::SendUnicode([string]$InputObject.text)
        return [pscustomobject]@{ textLength = ([string]$InputObject.text).Length }
    }
    if ($action -eq 'key') {
        Send-KeyCombination ([string]$InputObject.key)
        return [pscustomobject]@{ key = [string]$InputObject.key }
    }
    if ($action -eq 'scroll') {
        $deltaY = [int](Get-PropertyValue $InputObject 'deltaY' 0)
        $deltaX = [int](Get-PropertyValue $InputObject 'deltaX' 0)
        [DeepSeekEyesNative]::Scroll(-$deltaY, $deltaX)
        return [pscustomobject]@{ deltaX = $deltaX; deltaY = $deltaY }
    }
    if ($action -eq 'launch') {
        $arguments = @(Get-PropertyValue $InputObject 'arguments' @())
        $launch = @{ FilePath = [string]$InputObject.application; PassThru = $true }
        if ($arguments.Count -gt 0) { $launch.ArgumentList = $arguments }
        $process = Start-Process @launch
        return [pscustomobject]@{ pid = $process.Id; application = [string]$InputObject.application }
    }
    if ($action -in @('focus', 'move_window', 'resize_window', 'close_window')) {
        $target = Resolve-Window $InputObject
        $handle = [IntPtr]::new([Int64]::Parse($target.NativeId))
        if ($action -eq 'focus') {
            [DeepSeekEyesNative]::ShowWindow($handle, 9) | Out-Null
            [DeepSeekEyesNative]::SetForegroundWindow($handle) | Out-Null
        } elseif ($action -eq 'close_window') {
            [DeepSeekEyesNative]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
        } elseif ($action -eq 'move_window') {
            $point = Convert-ToAbsolutePoint $InputObject $Screen 'x' 'y'
            [DeepSeekEyesNative]::SetWindowPos($handle, [IntPtr]::Zero, $point[0], $point[1], $target.Width, $target.Height, 0x0004) | Out-Null
        } elseif ($action -eq 'resize_window') {
            [DeepSeekEyesNative]::SetWindowPos($handle, [IntPtr]::Zero, $target.X, $target.Y, [int]$InputObject.width, [int]$InputObject.height, 0x0004) | Out-Null
        }
        return [pscustomobject]@{ performed = $action; nativeId = $target.NativeId }
    }
    throw "unsupported Windows action $action"
}

try {
    $inputObject = Read-DeepSeekEyesInput
    $initialScreen = [pscustomobject]@{
        X = [DeepSeekEyesNative]::GetSystemMetrics(76)
        Y = [DeepSeekEyesNative]::GetSystemMetrics(77)
    }
    $actionResult = Invoke-Action $inputObject $initialScreen
    $settleMs = [int](Get-PropertyValue $inputObject 'settleMs' 0)
    if ($settleMs -gt 0 -and $inputObject.action -notin @('wait', 'observe')) { Start-Sleep -Milliseconds $settleMs }
    $screen = Capture-Desktop ([string]$inputObject.screenshotPath)
    $maximum = [int](Get-PropertyValue $inputObject 'maxWindows' 50)
    $windows = @([DeepSeekEyesNative]::Windows($maximum))
    $point = New-Object DeepSeekEyesNative+POINT
    [DeepSeekEyesNative]::GetCursorPos([ref]$point) | Out-Null
    $active = $windows | Where-Object Active | Select-Object -First 1
    [pscustomobject]@{
        ok = $true
        actionResult = $actionResult
        screen = $screen
        cursor = [pscustomobject]@{ x = $point.X - $screen.x; y = $point.Y - $screen.y }
        activeWindow = $active
        windows = $windows
        capabilities = [pscustomobject]@{
            screenshot = $true; mouse = $true; keyboard = $true; launch = $true; windows = $true; platform = 'Windows'
        }
    } | ConvertTo-Json -Depth 8 -Compress
} catch {
    [pscustomobject]@{
        ok = $false
        code = 'WINDOWS_DESKTOP_ACTION_FAILED'
        message = $_.Exception.Message
    } | ConvertTo-Json -Depth 4 -Compress
}
