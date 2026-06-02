$process = Start-Process -FilePath "D:\Anaconda\python.exe" -ArgumentList "backend\run.py" -WorkingDirectory "D:\project\shoplive" -NoNewWindow -PassThru
Start-Sleep -Seconds 5
if (-not $process.HasExited) {
    Write-Host "Server started successfully"
    Write-Host "Process ID: $($process.Id)"
} else {
    Write-Host "Server exited with code: $($process.ExitCode)"
}