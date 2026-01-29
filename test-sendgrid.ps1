# Test SendGrid Connection Script
# This script tests your SendGrid API key and sends a test email

param(
    [Parameter(Mandatory=$true)]
    [string]$ApiKey,
    
    [Parameter(Mandatory=$true)]
    [string]$FromEmail,
    
    [Parameter(Mandatory=$true)]
    [string]$ToEmail
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "SendGrid Connection Test" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Validate API key format
if (-not $ApiKey.StartsWith("SG.")) {
    Write-Host "❌ Error: API key should start with 'SG.'" -ForegroundColor Red
    exit 1
}

Write-Host "✓ API Key format valid" -ForegroundColor Green
Write-Host ""

# Test 1: Check API key validity
Write-Host "Test 1: Validating API Key..." -ForegroundColor Yellow

$headers = @{
    "Authorization" = "Bearer $ApiKey"
    "Content-Type" = "application/json"
}

try {
    $response = Invoke-RestMethod -Uri "https://api.sendgrid.com/v3/user/profile" -Method Get -Headers $headers
    
    Write-Host "✓ API Key is valid!" -ForegroundColor Green
    Write-Host "  User: $($response.username)" -ForegroundColor Gray
    Write-Host "  Email: $($response.email)" -ForegroundColor Gray
    Write-Host ""
} catch {
    Write-Host "❌ API Key validation failed!" -ForegroundColor Red
    Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Red
    
    if ($_.ErrorDetails.Message) {
        $errorDetails = $_.ErrorDetails.Message | ConvertFrom-Json
        if ($errorDetails.errors) {
            foreach ($err in $errorDetails.errors) {
                Write-Host "  - $($err.message)" -ForegroundColor Red
            }
        }
    }
    exit 1
}

# Test 2: Check sender verification
Write-Host "Test 2: Checking sender verification..." -ForegroundColor Yellow

try {
    $response = Invoke-RestMethod -Uri "https://api.sendgrid.com/v3/verified_senders" -Method Get -Headers $headers
    
    $verifiedEmails = $response.results | Where-Object { $_.verified -eq $true -and $_.from.email -eq $FromEmail }
    
    if ($verifiedEmails) {
        Write-Host "✓ Sender email '$FromEmail' is verified!" -ForegroundColor Green
        Write-Host ""
    } else {
        Write-Host "⚠️  Warning: Sender email '$FromEmail' may not be verified" -ForegroundColor Yellow
        Write-Host "  Make sure to verify this email in SendGrid dashboard" -ForegroundColor Yellow
        Write-Host ""
    }
} catch {
    Write-Host "⚠️  Could not check sender verification (this is okay)" -ForegroundColor Yellow
    Write-Host ""
}

# Test 3: Send test email
Write-Host "Test 3: Sending test email..." -ForegroundColor Yellow

$emailBody = @{
    personalizations = @(
        @{
            to = @(
                @{
                    email = $ToEmail
                }
            )
        }
    )
    from = @{
        email = $FromEmail
    }
    subject = "SendGrid Test Email - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    content = @(
        @{
            type = "text/plain"
            value = "This is a test email from SendGrid API. If you received this, your SendGrid connection is working correctly!"
        }
        @{
            type = "text/html"
            value = "<html><body><h2>SendGrid Test Email</h2><p>This is a test email from SendGrid API. If you received this, your SendGrid connection is working correctly!</p><p>Sent at: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')</p></body></html>"
        }
    )
} | ConvertTo-Json -Depth 10

try {
    $response = Invoke-RestMethod -Uri "https://api.sendgrid.com/v3/mail/send" -Method Post -Headers $headers -Body $emailBody
    
    Write-Host "✓ Test email sent successfully!" -ForegroundColor Green
    Write-Host "  Check inbox: $ToEmail" -ForegroundColor Gray
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "All tests passed! ✓" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Cyan
    
} catch {
    Write-Host "❌ Failed to send test email!" -ForegroundColor Red
    Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Red
    
    if ($_.ErrorDetails.Message) {
        $errorDetails = $_.ErrorDetails.Message | ConvertFrom-Json
        if ($errorDetails.errors) {
            Write-Host ""
            Write-Host "  Error Details:" -ForegroundColor Yellow
            foreach ($err in $errorDetails.errors) {
                Write-Host "  - $($err.message)" -ForegroundColor Red
                if ($err.field) {
                    Write-Host "    Field: $($err.field)" -ForegroundColor Gray
                }
                if ($err.help) {
                    Write-Host "    Help: $($err.help)" -ForegroundColor Gray
                }
            }
        }
    }
    exit 1
}
