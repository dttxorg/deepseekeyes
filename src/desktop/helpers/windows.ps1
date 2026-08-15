$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.Drawing

$script:DeepSeekEyesSemanticAvailable = $false
try {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $script:DeepSeekEyesSemanticAvailable = $true
} catch {
    $script:DeepSeekEyesSemanticAvailable = $false
}

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
        if ($null -ne $nativeId) { continue }
        if (-not [string]::IsNullOrWhiteSpace($title) -and $candidate.Title.IndexOf($title, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $candidate }
        if (-not [string]::IsNullOrWhiteSpace($application) -and $candidate.Application.IndexOf($application, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $candidate }
    }
    throw 'target Windows application/window was not found'
}

function Resolve-WindowByNativeId([string]$NativeId) {
    if ([string]::IsNullOrWhiteSpace($NativeId)) { return $null }
    foreach ($candidate in [DeepSeekEyesNative]::Windows(500)) {
        if ($candidate.NativeId -eq $NativeId) { return $candidate }
    }
    return $null
}

function Resolve-CaptureWindow($InputObject) {
    if ([string](Get-PropertyValue $InputObject 'captureScope' 'desktop') -ne 'window') { return $null }
    $capture = Get-PropertyValue $InputObject 'captureWindow'
    $nativeId = if ($null -eq $capture) { '' } else { [string](Get-PropertyValue $capture 'nativeId' '') }
    if (-not [string]::IsNullOrWhiteSpace($nativeId)) {
        $resolved = Resolve-WindowByNativeId $nativeId
        if ($null -ne $resolved) { return $resolved }
        throw 'target Windows capture window was not found'
    }
    $application = [string](Get-PropertyValue $InputObject 'captureApplication' '')
    $title = [string](Get-PropertyValue $InputObject 'captureTitle' '')
    if ([string]::IsNullOrWhiteSpace($application)) { $application = [string](Get-PropertyValue $InputObject 'application' '') }
    if ([string]::IsNullOrWhiteSpace($title)) { $title = [string](Get-PropertyValue $InputObject 'title' '') }
    $explicit = -not [string]::IsNullOrWhiteSpace($nativeId) `
        -or -not [string]::IsNullOrWhiteSpace($application) `
        -or -not [string]::IsNullOrWhiteSpace($title)
    if (-not [string]::IsNullOrWhiteSpace($application) -or -not [string]::IsNullOrWhiteSpace($title)) {
        try {
            return Resolve-Window ([pscustomobject]@{ application = $application; title = $title })
        } catch {
            if ($explicit) { throw }
        }
    }
    if ($explicit) { throw 'target Windows capture window was not found' }
    $active = [DeepSeekEyesNative]::GetForegroundWindow().ToInt64().ToString()
    $activeWindow = Resolve-WindowByNativeId $active
    if ($null -eq $activeWindow) { throw 'active Windows capture window was not found' }
    return $activeWindow
}

function Get-AutomationRuntimeId($Element, [string]$Fallback) {
    try {
        $runtime = @($Element.GetRuntimeId())
        if ($runtime.Count -gt 0) { return ($runtime -join '.') }
    } catch { }
    return $Fallback
}

function Get-AutomationPattern($Element, $Pattern) {
    try {
        $value = $null
        if ($Element.TryGetCurrentPattern($Pattern, [ref]$value)) { return $value }
    } catch { }
    return $null
}

function Get-AutomationActions($Element) {
    $actions = New-Object System.Collections.Generic.List[string]
    if ($null -ne (Get-AutomationPattern $Element ([System.Windows.Automation.InvokePattern]::Pattern))) { $actions.Add('invoke') }
    if ($null -ne (Get-AutomationPattern $Element ([System.Windows.Automation.ValuePattern]::Pattern))) { $actions.Add('set_value') }
    if ($null -ne (Get-AutomationPattern $Element ([System.Windows.Automation.TogglePattern]::Pattern))) { $actions.Add('toggle') }
    if ($null -ne (Get-AutomationPattern $Element ([System.Windows.Automation.SelectionItemPattern]::Pattern))) { $actions.Add('select') }
    if ($null -ne (Get-AutomationPattern $Element ([System.Windows.Automation.ExpandCollapsePattern]::Pattern))) {
        $actions.Add('expand')
        $actions.Add('collapse')
    }
    if ($null -ne (Get-AutomationPattern $Element ([System.Windows.Automation.ScrollItemPattern]::Pattern))) { $actions.Add('scroll_into_view') }
    $actions.Add('focus')
    return @($actions)
}

function Convert-AutomationElement($Element, $Window, [int[]]$Path) {
    try {
        $current = $Element.Current
        $rectangle = $current.BoundingRectangle
        $programmatic = [string]$current.ControlType.ProgrammaticName
        $role = if ($programmatic.Contains('.')) { $programmatic.Substring($programmatic.LastIndexOf('.') + 1).ToLowerInvariant() } else { $programmatic.ToLowerInvariant() }
        $runtime = Get-AutomationRuntimeId $Element (($Path -join '.'))
        $valuePattern = Get-AutomationPattern $Element ([System.Windows.Automation.ValuePattern]::Pattern)
        $togglePattern = Get-AutomationPattern $Element ([System.Windows.Automation.TogglePattern]::Pattern)
        $selectionPattern = Get-AutomationPattern $Element ([System.Windows.Automation.SelectionItemPattern]::Pattern)
        $value = if ($null -eq $valuePattern -or $current.IsPassword) { $null } else { [string]$valuePattern.Current.Value }
        $checked = if ($null -eq $togglePattern) { $null } else { [string]$togglePattern.Current.ToggleState -eq 'On' }
        $selected = if ($null -eq $selectionPattern) { $null } else { [bool]$selectionPattern.Current.IsSelected }
        return [pscustomobject]@{
            nativeId = "$($Window.NativeId):$runtime"
            windowNativeId = $Window.NativeId
            pid = [int]$current.ProcessId
            path = @($Path)
            automationId = [string]$current.AutomationId
            className = [string]$current.ClassName
            role = $role
            name = [string]$current.Name
            description = [string]$current.HelpText
            value = $value
            password = [bool]$current.IsPassword
            enabled = [bool]$current.IsEnabled
            visible = -not [bool]$current.IsOffscreen
            focused = [bool]$current.HasKeyboardFocus
            editable = $null -ne $valuePattern -and -not [bool]$valuePattern.Current.IsReadOnly
            selected = $selected
            checked = $checked
            x = [double]$rectangle.X
            y = [double]$rectangle.Y
            width = [double]$rectangle.Width
            height = [double]$rectangle.Height
            actions = @(Get-AutomationActions $Element)
        }
    } catch { return $null }
}

function Add-AutomationChildren($Element, $Window, [int[]]$Path, [int]$Depth, [int]$Maximum, $Output, $Walker) {
    if ($Output.Count -ge $Maximum -or $Depth -gt 12) { return }
    $record = Convert-AutomationElement $Element $Window $Path
    if ($null -ne $record) { $Output.Add($record) }
    if ($Output.Count -ge $Maximum) { return }
    try { $child = $Walker.GetFirstChild($Element) } catch { $child = $null }
    $index = 0
    while ($null -ne $child -and $Output.Count -lt $Maximum) {
        Add-AutomationChildren $child $Window ($Path + $index) ($Depth + 1) $Maximum $Output $Walker
        try { $child = $Walker.GetNextSibling($child) } catch { $child = $null }
        $index += 1
    }
}

function Get-AutomationElements($Window, [int]$Maximum) {
    if (-not $script:DeepSeekEyesSemanticAvailable -or $null -eq $Window -or $Maximum -le 0) { return @() }
    try {
        $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new([Int64]::Parse($Window.NativeId)))
        if ($null -eq $root) { return @() }
        $output = New-Object System.Collections.Generic.List[object]
        Add-AutomationChildren $root $Window @() 0 $Maximum $output ([System.Windows.Automation.TreeWalker]::RawViewWalker)
        return @($output)
    } catch { return @() }
}

function Resolve-AutomationElement($InputObject) {
    if (-not $script:DeepSeekEyesSemanticAvailable) { throw 'Windows UI Automation is unavailable' }
    $element = Get-PropertyValue $InputObject 'element'
    if ($null -eq $element) { throw 'element metadata is missing' }
    $wanted = [string](Get-PropertyValue $element 'nativeId' '')
    $windowNativeId = [string](Get-PropertyValue $element 'windowNativeId' '')
    $window = Resolve-WindowByNativeId $windowNativeId
    if ($null -eq $window) { throw 'element window is no longer available' }
    $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new([Int64]::Parse($window.NativeId)))
    if ($null -eq $root) { throw 'element accessibility root is unavailable' }
    $rootRuntime = Get-AutomationRuntimeId $root ''
    if ("$($window.NativeId):$rootRuntime" -eq $wanted) { return $root }
    $all = $root.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition
    )
    for ($index = 0; $index -lt $all.Count; $index += 1) {
        $candidate = $all.Item($index)
        $runtime = Get-AutomationRuntimeId $candidate ''
        if ("$($window.NativeId):$runtime" -eq $wanted) { return $candidate }
    }
    throw 'target Windows accessibility element was not found in the current state'
}

function Get-AutomationCenter($Element) {
    $rectangle = $Element.Current.BoundingRectangle
    if ($rectangle.Width -le 0 -or $rectangle.Height -le 0) { throw 'accessibility element has no clickable bounds' }
    return @(
        [int][Math]::Round($rectangle.X + $rectangle.Width / 2),
        [int][Math]::Round($rectangle.Y + $rectangle.Height / 2)
    )
}

function Invoke-AutomationAction($Element, [string]$ActionName) {
    $normalized = $ActionName.Trim().ToLowerInvariant()
    if ($normalized -eq 'focus') {
        $Element.SetFocus()
        return
    }
    if ($normalized -eq 'invoke') {
        $pattern = Get-AutomationPattern $Element ([System.Windows.Automation.InvokePattern]::Pattern)
        if ($null -eq $pattern) { throw 'element does not expose invoke' }
        $pattern.Invoke()
        return
    }
    if ($normalized -eq 'toggle') {
        $pattern = Get-AutomationPattern $Element ([System.Windows.Automation.TogglePattern]::Pattern)
        if ($null -eq $pattern) { throw 'element does not expose toggle' }
        $pattern.Toggle()
        return
    }
    if ($normalized -eq 'select') {
        $pattern = Get-AutomationPattern $Element ([System.Windows.Automation.SelectionItemPattern]::Pattern)
        if ($null -eq $pattern) { throw 'element does not expose select' }
        $pattern.Select()
        return
    }
    if ($normalized -in @('expand', 'collapse')) {
        $pattern = Get-AutomationPattern $Element ([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
        if ($null -eq $pattern) { throw 'element does not expose expand/collapse' }
        if ($normalized -eq 'expand') { $pattern.Expand() } else { $pattern.Collapse() }
        return
    }
    if ($normalized -eq 'scroll_into_view') {
        $pattern = Get-AutomationPattern $Element ([System.Windows.Automation.ScrollItemPattern]::Pattern)
        if ($null -eq $pattern) { throw 'element does not expose scroll_into_view' }
        $pattern.ScrollIntoView()
        return
    }
    throw "unsupported Windows accessibility action $ActionName"
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

function Capture-Desktop([string]$Path, $TargetWindow) {
    if ($null -ne $TargetWindow -and $TargetWindow.Width -gt 0 -and $TargetWindow.Height -gt 0) {
        $x = [int]$TargetWindow.X
        $y = [int]$TargetWindow.Y
        $width = [int]$TargetWindow.Width
        $height = [int]$TargetWindow.Height
    } else {
        $x = [DeepSeekEyesNative]::GetSystemMetrics(76)
        $y = [DeepSeekEyesNative]::GetSystemMetrics(77)
        $width = [DeepSeekEyesNative]::GetSystemMetrics(78)
        $height = [DeepSeekEyesNative]::GetSystemMetrics(79)
        if ($width -le 0 -or $height -le 0) {
            $x = 0; $y = 0
            $width = [DeepSeekEyesNative]::GetSystemMetrics(0)
            $height = [DeepSeekEyesNative]::GetSystemMetrics(1)
        }
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
    if ($action -in @('invoke', 'set_value', 'perform_action')) {
        $targetElement = Resolve-AutomationElement $InputObject
        if ($action -eq 'invoke') {
            try { Invoke-AutomationAction $targetElement 'invoke' }
            catch {
                $center = Get-AutomationCenter $targetElement
                [DeepSeekEyesNative]::SetCursorPos($center[0], $center[1]) | Out-Null
                [DeepSeekEyesNative]::mouse_event([DeepSeekEyesNative]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
                [DeepSeekEyesNative]::mouse_event([DeepSeekEyesNative]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
            }
        } elseif ($action -eq 'set_value') {
            $pattern = Get-AutomationPattern $targetElement ([System.Windows.Automation.ValuePattern]::Pattern)
            if ($null -ne $pattern -and -not $pattern.Current.IsReadOnly) {
                $pattern.SetValue([string]$InputObject.value)
            } else {
                $targetElement.SetFocus()
                Send-KeyCombination 'CTRL+A'
                [DeepSeekEyesNative]::SendUnicode([string]$InputObject.value)
            }
        } else {
            Invoke-AutomationAction $targetElement ([string]$InputObject.actionName)
        }
        return [pscustomobject]@{ performed = $action; element = [string](Get-PropertyValue (Get-PropertyValue $InputObject 'element') 'nativeId' '') }
    }
    if ($action -in @('click', 'double_click', 'right_click', 'move_cursor')) {
        $elementInput = Get-PropertyValue $InputObject 'element'
        if ($null -ne $elementInput -and $action -ne 'move_cursor') {
            $targetElement = Resolve-AutomationElement $InputObject
            $point = Get-AutomationCenter $targetElement
        } else {
            $point = Convert-ToAbsolutePoint $InputObject $Screen 'x' 'y'
        }
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
        if ($null -ne (Get-PropertyValue $InputObject 'element')) {
            (Resolve-AutomationElement $InputObject).SetFocus()
        }
        [DeepSeekEyesNative]::SendUnicode([string]$InputObject.text)
        return [pscustomobject]@{ textLength = ([string]$InputObject.text).Length }
    }
    if ($action -eq 'key') {
        Send-KeyCombination ([string]$InputObject.key)
        return [pscustomobject]@{ key = [string]$InputObject.key }
    }
    if ($action -eq 'scroll') {
        if ($null -ne (Get-PropertyValue $InputObject 'element')) {
            $targetElement = Resolve-AutomationElement $InputObject
            $center = Get-AutomationCenter $targetElement
            [DeepSeekEyesNative]::SetCursorPos($center[0], $center[1]) | Out-Null
        }
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
    $captureWindow = Resolve-CaptureWindow $inputObject
    $screen = Capture-Desktop ([string]$inputObject.screenshotPath) $captureWindow
    $maximum = [int](Get-PropertyValue $inputObject 'maxWindows' 50)
    $windows = @([DeepSeekEyesNative]::Windows($maximum))
    $point = New-Object DeepSeekEyesNative+POINT
    [DeepSeekEyesNative]::GetCursorPos([ref]$point) | Out-Null
    $active = $windows | Where-Object Active | Select-Object -First 1
    $semanticEnabled = [bool](Get-PropertyValue $inputObject 'semantic' $true)
    $semanticWindow = $captureWindow
    $maxElements = [int](Get-PropertyValue $inputObject 'maxElements' 200)
    $elements = if ($semanticEnabled) { @(Get-AutomationElements $semanticWindow $maxElements) } else { @() }
    [pscustomobject]@{
        ok = $true
        actionResult = $actionResult
        screen = $screen
        cursor = [pscustomobject]@{ x = $point.X - $screen.x; y = $point.Y - $screen.y }
        activeWindow = $active
        capturedWindow = $captureWindow
        windows = $windows
        elements = $elements
        elementTotal = $elements.Count
        elementsTruncated = ($semanticEnabled -and $elements.Count -ge $maxElements)
        capabilities = [pscustomobject]@{
            screenshot = $true; mouse = $true; keyboard = $true; launch = $true; windows = $true
            accessibility = ($semanticEnabled -and $script:DeepSeekEyesSemanticAvailable)
            windowCapture = $true; elementActions = ($semanticEnabled -and $script:DeepSeekEyesSemanticAvailable)
            semanticScope = 'window'
            platform = 'Windows'
        }
    } | ConvertTo-Json -Depth 8 -Compress
} catch {
    [pscustomobject]@{
        ok = $false
        code = 'WINDOWS_DESKTOP_ACTION_FAILED'
        message = $_.Exception.Message
    } | ConvertTo-Json -Depth 4 -Compress
}
