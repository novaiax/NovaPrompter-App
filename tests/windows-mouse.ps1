param(
  [ValidateSet('drag','resize','shrink')] [string]$Action,
  [int]$X, [int]$Y, [int]$Width, [int]$Height,
  [double]$Scale = 1, [long]$Handle
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Mouse {
  [StructLayout(LayoutKind.Sequential)]
  public struct Point { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point lpPoint);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
"@

$start = New-Object Mouse+Point
[Mouse]::GetCursorPos([ref]$start) | Out-Null
try {
  if ($Action -eq 'drag') {
    $fromX = [int](($X + [Math]::Min(200,$Width * .4)) * $Scale)
    $fromY = [int](($Y + 18) * $Scale)
    $dx = -42
    $dy = 36
  } else {
    $fromX = [int](($X + $Width - 8) * $Scale)
    $fromY = [int](($Y + $Height - 8) * $Scale)
    $dx = 64
    $dy = 45
    if ($Action -eq 'shrink') { $dx = -42; $dy = -30 }
  }
  [Mouse]::SetCursorPos($fromX, $fromY) | Out-Null
  Start-Sleep -Milliseconds 260
  $point = New-Object Mouse+Point
  $point.X = $fromX
  $point.Y = $fromY
  $pointWindow = [Mouse]::GetAncestor([Mouse]::WindowFromPoint($point), 2)
  if ($Handle -and $pointWindow.ToInt64() -ne $Handle) { throw 'La souris ne pointe pas sur la fenêtre de test.' }
  [Mouse]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  for ($index = 1; $index -le 14; $index++) {
    [Mouse]::SetCursorPos([int]($fromX + $dx*$index/14), [int]($fromY + $dy*$index/14)) | Out-Null
    Start-Sleep -Milliseconds 20
  }
} finally {
  [Mouse]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  [Mouse]::SetCursorPos($start.X, $start.Y) | Out-Null
}
