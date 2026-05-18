param(
    [int]$Port = 8080
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Add-Type -AssemblyName System.Web

$listener = New-Object System.Net.HttpListener
$prefix = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)
$listener.Start()

Write-Host "Demo server running at $prefix"
Write-Host "Press Ctrl+C to stop."

function Get-ContentType($path) {
    switch ([System.IO.Path]::GetExtension($path).ToLowerInvariant()) {
        '.html' { 'text/html; charset=utf-8' }
        '.css' { 'text/css; charset=utf-8' }
        '.js' { 'application/javascript; charset=utf-8' }
        '.json' { 'application/json; charset=utf-8' }
        '.png' { 'image/png' }
        '.jpg' { 'image/jpeg' }
        '.jpeg' { 'image/jpeg' }
        '.svg' { 'image/svg+xml' }
        default { 'application/octet-stream' }
    }
}

try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        $reqPath = $ctx.Request.Url.AbsolutePath.TrimStart('/')
        if ([string]::IsNullOrWhiteSpace($reqPath)) { $reqPath = 'index.html' }

        $safePath = [System.IO.Path]::GetFullPath((Join-Path $root $reqPath))
        if (-not $safePath.StartsWith($root)) {
            $ctx.Response.StatusCode = 403
            $ctx.Response.Close()
            continue
        }

        if (-not (Test-Path $safePath -PathType Leaf)) {
            $ctx.Response.StatusCode = 404
            $msg = [System.Text.Encoding]::UTF8.GetBytes('Not Found')
            $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
            $ctx.Response.Close()
            continue
        }

        $bytes = [System.IO.File]::ReadAllBytes($safePath)
        $ctx.Response.ContentType = Get-ContentType $safePath
        $ctx.Response.ContentLength64 = $bytes.Length
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $ctx.Response.Close()
    }
}
finally {
    $listener.Stop()
    $listener.Close()
}
