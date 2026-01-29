# Simple SendGrid Test (PowerShell)
# Quick test using curl or Invoke-WebRequest

param(
    [string]$ApiKey = $env:SENDGRID_API_KEY,
    [string]$FromEmail = $env:FROM_EMAIL,
    [string]$ToEmail = "test@example.com"
)

if (-not $ApiKey) {
    Write-Host "Usage: .\test-sendgrid-simple.ps1 -ApiKey 'SG.xxx' -FromEmail 'noreply@example.com' -ToEmail 'test@example.com'" -ForegroundColor Yellow
    Write-Host "Or set environment variables: SENDGRID_API_KEY and FROM_EMAIL" -ForegroundColor Yellow
    exit 1
}

Write-Host "Testing SendGrid API Key..." -ForegroundColor Cyan

# Test API Key
$headers = @{
    "Authorization" = "Bearer $ApiKey"
}

try {
    $response = Invoke-RestMethod -Uri "https://api.sendgrid.com/v3/user/profile" -Method Get -Headers $headers
    Write-Host "✓ API Key is valid! User: $($response.username)" -ForegroundColor Green
    
    # Send test email
    Write-Host "Sending test email..." -ForegroundColor Cyan
    
    $body = @{
        personalizations = @(
            @{
                to = @(@{ email = $ToEmail })
            }
        )
        from = @{ email = $FromEmail }
        subject = "SendGrid Test - $(Get-Date -Format 'HH:mm:ss')"
        content = @(
            @{
                type = "text/plain"
                value = "This is a test email from SendGrid!"
            }
        )
    } | ConvertTo-Json -Depth 10
    
    Invoke-RestMethod -Uri "https://api.sendgrid.com/v3/mail/send" -Method Post -Headers $headers -Body $body -ContentType "application/json"
    
    Write-Host "✓ Test email sent to $ToEmail!" -ForegroundColor Green
    
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host $_.ErrorDetails.Message -ForegroundColor Red
    }
}
