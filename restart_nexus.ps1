$ErrorActionPreference = "SilentlyContinue"

# Wait to ensure current process can exit naturally if it's the one triggering this
Start-Sleep -Seconds 3

# Ensure we are in the correct directory so that .env and relative paths work
$baseDir = $PSScriptRoot
if (-not $baseDir) { $baseDir = (Get-Location).Path }
Set-Location -Path $baseDir

Write-Output "CERRANDO PROCESOS PREVIOS (RELAUCH PREP)..."
# Kill processes exactly matching "server.js". Get-Process .Path matches node.exe, not arguments, so we use WMI.
Get-WmiObject Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match "server.js" } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force
}

Write-Output "LIMPIANDO PUERTO 3000..."
$port = 3000
$tcpConns = Get-NetTCPConnection -LocalPort $port
if ($tcpConns) {
    foreach ($conn in $tcpConns) {
        $procId = $conn.OwningProcess
        if ($procId) {
            Stop-Process -Id $procId -Force
        }
    }
}

Start_Sleep -Seconds 2

Write-Output "BUSCANDO ACTUALIZACIONES DE EVOLUCIÓN (.next)..."
$nextFiles = Get-ChildItem -Path $baseDir -Filter "*.next" -Recurse
if ($nextFiles) {
    foreach ($next in $nextFiles) {
        $originalPath = $next.FullName.Replace(".next", "")
        Write-Output "EVOLUCIONANDO: $($next.Name) -> $($originalPath)..."
        Move-Item -Path $next.FullName -Destination $originalPath -Force
    }
}

Write-Output "LANZANDO APLICACIÓN [ASA NEXUS v8.2 FABRIC]..."
# Restart server via the VBS launcher or directly, but explicitly setting the WorkingDirectory
$launcherPath = Join-Path $baseDir "asa_launcher.vbs"
if (Test-Path $launcherPath) {
    Start-Process -FilePath "wscript.exe" -ArgumentList "`"$launcherPath`"" -WorkingDirectory $baseDir -WindowStyle Hidden
} else {
    # Redirigir la salida al log de pulso v8.2
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c node server.js > fabric_v8_pulse.log 2>&1" -WorkingDirectory $baseDir -WindowStyle Hidden
}

Write-Output "ACTIVANDO CENTINELA DE SEGURIDAD..."
Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run sentinel > nexus_sentinel_alerts.log 2>&1" -WorkingDirectory $baseDir -WindowStyle Hidden

Start-Sleep -Seconds 2
Write-Output "ABRIENDO INTERFAZ EN EL NAVEGADOR..."
# Start-Process "http://localhost:3000" 
