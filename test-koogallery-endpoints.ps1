# KooGallery Endpoint Testing Script for Windows PowerShell
# This script tests all KooGallery SaaS 2.0 endpoints

Write-Host "🧪 Testing KooGallery SaaS 2.0 Endpoints" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green

# Bypass SSL certificate validation for testing
[System.Net.ServicePointManager]::ServerCertificateValidationCallback = {$true}

# Base URL
$baseUrl = "https://localhost"

# Test data
$testOrderId = "test-order-$(Get-Date -Format 'yyyyMMddHHmmss')"
$testOrderLineId = "test-line-$(Get-Date -Format 'yyyyMMddHHmmss')"
$testBusinessId = "test-business-$(Get-Date -Format 'yyyyMMddHHmmss')"
$testInstanceId = "test-instance-$(Get-Date -Format 'yyyyMMddHHmmss')"

Write-Host "`n📋 Test Data:" -ForegroundColor Yellow
Write-Host "Order ID: $testOrderId"
Write-Host "Order Line ID: $testOrderLineId"
Write-Host "Business ID: $testBusinessId"
Write-Host "Instance ID: $testInstanceId"

# Function to test endpoint
function Test-KooGalleryEndpoint {
    param(
        [string]$Name,
        [string]$Url,
        [string]$Body,
        [string]$ExpectedStatus = "401"
    )
    
    Write-Host "`n🔍 Testing $Name" -ForegroundColor Cyan
    Write-Host "URL: $Url"
    Write-Host "Expected: $ExpectedStatus (signature verification error)"
    
    try {
        $response = Invoke-WebRequest -Uri $Url -Method POST -ContentType "application/json" -Body $Body -ErrorAction Stop
        Write-Host "❌ Unexpected success: $($response.StatusCode)" -ForegroundColor Red
        Write-Host "Response: $($response.Content)"
    }
    catch {
        if ($_.Exception.Response.StatusCode -eq 401) {
            Write-Host "✅ SUCCESS: Got expected 401 Unauthorized (signature verification working)" -ForegroundColor Green
        }
        elseif ($_.Exception.Response.StatusCode -eq 400) {
            Write-Host "✅ SUCCESS: Got expected 400 Bad Request (parameter validation working)" -ForegroundColor Green
        }
        else {
            Write-Host "⚠️  Got status: $($_.Exception.Response.StatusCode)" -ForegroundColor Yellow
            Write-Host "Error: $($_.Exception.Message)"
        }
    }
}

# Test 1: Create Instance
$createInstanceBody = @{
    activity = "newInstance"
    orderId = $testOrderId
    orderLineId = $testOrderLineId
    businessId = $testBusinessId
    testFlag = "1"
} | ConvertTo-Json

Test-KooGalleryEndpoint -Name "Create Instance" -Url "$baseUrl/api/koogallery/create-instance" -Body $createInstanceBody

# Test 2: Query Instance
$queryInstanceBody = @{
    activity = "queryInstance"
    instanceId = $testInstanceId
} | ConvertTo-Json

Test-KooGalleryEndpoint -Name "Query Instance" -Url "$baseUrl/api/koogallery/query-instance" -Body $queryInstanceBody

# Test 3: Update Instance
$updateInstanceBody = @{
    activity = "refreshInstance"
    scene = "RENEWAL"
    orderId = $testOrderId
    orderLineId = $testOrderLineId
    instanceId = $testInstanceId
    expireTime = "20241231235959"
    testFlag = "1"
} | ConvertTo-Json

Test-KooGalleryEndpoint -Name "Update Instance" -Url "$baseUrl/api/koogallery/update-instance" -Body $updateInstanceBody

# Test 4: Update Instance Status
$updateStatusBody = @{
    activity = "updateInstanceStatus"
    instanceId = $testInstanceId
    status = "FREEZE"
    testFlag = "1"
} | ConvertTo-Json

Test-KooGalleryEndpoint -Name "Update Instance Status" -Url "$baseUrl/api/koogallery/update-instance-status" -Body $updateStatusBody

# Test 5: Release Instance
$releaseInstanceBody = @{
    activity = "releaseInstance"
    instanceId = $testInstanceId
    orderId = $testOrderId
    orderLineId = $testOrderLineId
    testFlag = "1"
} | ConvertTo-Json

Test-KooGalleryEndpoint -Name "Release Instance" -Url "$baseUrl/api/koogallery/release-instance" -Body $releaseInstanceBody

# Test 6: Upgrade Instance
$upgradeInstanceBody = @{
    activity = "upgradeInstance"
    instanceId = $testInstanceId
    orderId = $testOrderId
    orderLineId = $testOrderLineId
    productId = "PRODUCT_UPGRADE_123"
    testFlag = "1"
} | ConvertTo-Json

Test-KooGalleryEndpoint -Name "Upgrade Instance" -Url "$baseUrl/api/koogallery/upgrade-instance" -Body $upgradeInstanceBody

# Test 7: Health Check
Write-Host "`n🔍 Testing Health Check" -ForegroundColor Cyan
try {
    $healthResponse = Invoke-WebRequest -Uri "$baseUrl/api/health" -Method GET -ErrorAction Stop
    Write-Host "✅ Health Check SUCCESS: $($healthResponse.StatusCode)" -ForegroundColor Green
    Write-Host "Response: $($healthResponse.Content)"
}
catch {
    Write-Host "❌ Health Check FAILED: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 8: Check Database Tables
Write-Host "`n🔍 Checking Database Tables" -ForegroundColor Cyan
try {
    $dbCheck = docker exec prompify-postgres psql -U prompify_user -d prompify -c "SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'koogallery_%';"
    Write-Host "✅ Database Check:" -ForegroundColor Green
    Write-Host $dbCheck
}
catch {
    Write-Host "❌ Database Check FAILED: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 9: Check KooGallery Logs
Write-Host "`n🔍 Checking KooGallery Logs" -ForegroundColor Cyan
try {
    $logsCheck = docker exec prompify-postgres psql -U prompify_user -d prompify -c "SELECT COUNT(*) as log_count FROM koogallery_logs;"
    Write-Host "✅ KooGallery Logs Count:" -ForegroundColor Green
    Write-Host $logsCheck
}
catch {
    Write-Host "❌ Logs Check FAILED: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n🎉 Testing Complete!" -ForegroundColor Green
Write-Host "===================" -ForegroundColor Green
Write-Host "All endpoints should return 401 Unauthorized (signature verification working)" -ForegroundColor Yellow
Write-Host "Health check should return 200 OK" -ForegroundColor Yellow
Write-Host "`nNext steps:" -ForegroundColor Cyan
Write-Host "1. Add your KooGallery access key to .env file" -ForegroundColor White
Write-Host "2. Test with KooGallery's test environment" -ForegroundColor White
Write-Host "3. Configure endpoints in KooGallery Seller Console" -ForegroundColor White