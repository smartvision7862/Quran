$port = 8080
$url = "http://localhost:8080/index.html#dashboard"

Write-Host "Starting local web server on port $port..." -ForegroundColor Green
Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory "g:\WEB ANDROID APP\AI Talkbot\quran\web_app" -NoNewWindow

# Wait a moment for server to initialize
Start-Sleep -Seconds 1

Write-Host "Opening $url in default browser..." -ForegroundColor Cyan
Start-Process $url
