<?php
// Settings management API
// Provides a simple RESTful key-value store for user settings
// Format: settings.php/{userId}[/{key}]
header('Content-Type: application/json');

// Enable error reporting for debugging
ini_set('display_errors', 1);
error_reporting(E_ALL);

// Define log file path
$logFile = '/tmp/settings_php.log';

// Configuration
$maxKeyLength = 64;      // Maximum length for setting keys
$maxValueLength = 1024;  // Maximum length for setting values

// Define default settings
$defaultSettings = [
    "creation-date" => date('Y-m-d H:i:s'),
    "version" => "1"
];

// Load .env variables from a JSON file
$envFilePath = __DIR__ . '/.env';
if (file_exists($envFilePath)) {
    $envContent = file_get_contents($envFilePath);
    $envVariables = json_decode($envContent, true);

    if (json_last_error() === JSON_ERROR_NONE) {
        foreach ($envVariables as $key => $value) {
            $_ENV[$key] = $value;
        }
    } else {
        error_log("Failed to parse .env file: " . json_last_error_msg());
    }
} else {
    error_log(".env file not found at $envFilePath");
}

// SQL database configuration
$dbName = $_ENV['SQL_DB_NAME'] ?? 'teslacloud';
$dbHost = $_ENV['SQL_HOST'] ?? null;
$dbUser = $_ENV['SQL_USER'] ?? null;
$dbPass = $_ENV['SQL_PASS'] ?? null;
$dbPort = $_ENV['SQL_PORT'] ?? '3306';

// Establish database connection
if (!$dbHost || !$dbName || !$dbUser) {
    logMessage("Missing required database configuration", "ERROR");
    http_response_code(500);
    echo json_encode(['error' => 'Database configuration missing']);
    exit;
}

// Connect to database
try {
    $dsn = "mysql:host={$dbHost};port={$dbPort};dbname={$dbName};charset=utf8mb4";
    $options = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ];
    
    $dbConnection = new PDO($dsn, $dbUser, $dbPass, $options);
    
    // Check if the required table exists, create it if not
    $tableCheck = $dbConnection->query("SHOW TABLES LIKE 'user_settings'");
    if ($tableCheck->rowCount() == 0) {
        $sql = "CREATE TABLE user_settings (
            user_id VARCHAR(255) NOT NULL,
            setting_key VARCHAR({$maxKeyLength}) NOT NULL,
            setting_value TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, setting_key)
        )";
        $dbConnection->exec($sql);
    }
    
    // Check if user_ids table exists, create it if not
    $userIdsTableCheck = $dbConnection->query("SHOW TABLES LIKE 'user_ids'");
    if ($userIdsTableCheck->rowCount() == 0) {
        $sql = "CREATE TABLE user_ids (
            user_id VARCHAR(255) NOT NULL,
            initial_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            login_count INT DEFAULT 0,
            PRIMARY KEY (user_id)
        )";
        $dbConnection->exec($sql);
        logMessage("Created user_ids table");
    }
} catch (PDOException $e) {
    $errorMessage = "Database connection failed: " . $e->getMessage();
    logMessage($errorMessage, "ERROR");
    http_response_code(500);
    echo json_encode(['error' => 'Database connection failed']);
    exit;
}

// Parse the request URI to extract user and key
$requestUri = $_SERVER['REQUEST_URI'];
$uriParts = explode('/', trim(parse_url($requestUri, PHP_URL_PATH), '/'));

// Determine which parts of the URL contain our parameters
$userId = null;
$key = null;

// Check if we have enough parts to contain a user ID
if (count($uriParts) > 1) {
    $scriptName = basename(__FILE__); // Should be settings.php
    $scriptPos = array_search($scriptName, $uriParts);
    
    if ($scriptPos !== false && isset($uriParts[$scriptPos + 1])) {
        $userId = $uriParts[$scriptPos + 1];
        
        // Check if we also have a key
        if (isset($uriParts[$scriptPos + 2])) {
            $key = $uriParts[$scriptPos + 2];
        }
    }
}

// Handle the request based on method
$method = $_SERVER['REQUEST_METHOD'];

switch ($method) {
    case 'POST':
        // POST request - create a new user settings resource
        if (!$userId || !validateUserId($userId)) {
            logMessage("Invalid or missing user ID: $userId", "ERROR");
            http_response_code(400);
            exit;
        }
        
        // Check if user settings already exist
        if (userSettingsExist($userId)) {
            logMessage("User settings already exist for $userId", "WARNING");
            http_response_code(409); // Conflict
            exit;
        }
        
        // Save the default settings
        if (saveUserSettings($userId, $defaultSettings)) {
            // Add entry to user_ids table
            initializeUserIdEntry($userId);
            
            logMessage("User settings created successfully for $userId");
            http_response_code(201); // Created
            echo json_encode([
                'success' => true, 
                'userId' => $userId, 
                'message' => 'User settings created with default values',
                'settings' => $defaultSettings
            ]);
        } else {
            logMessage("Failed to create user settings for $userId", "ERROR");
            http_response_code(500);
        }
        break;
        
    case 'HEAD':
        // HEAD request - check if user settings exist without returning content
        if (!$userId || !validateUserId($userId)) {
            logMessage("Invalid or missing user ID: $userId", "ERROR");
            http_response_code(400);
            exit;
        }
        
        if (!userSettingsExist($userId)) {
            logMessage("User settings not found for $userId", "WARNING");
            http_response_code(404);
            exit;
        }
        
        // Update user_ids table - update last_login timestamp and increment login_count
        initializeUserIdEntry($userId);
        
        // Resource exists, return 200 OK (with no body)
        http_response_code(200);
        exit;
        
    case 'GET':
        // GET request - retrieve settings for a user
        if (!$userId || !validateUserId($userId)) {
            logMessage("Invalid or missing user ID: $userId", "ERROR");
            http_response_code(400);
            echo json_encode(['error' => 'Invalid or missing user ID in URL path']);
            exit;
        }

        // Check if the user settings exist
        if (!userSettingsExist($userId)) {
            logMessage("User settings not found for $userId", "WARNING");
            http_response_code(404);
            exit;
        }

        if ($key) {
            // Check if there's an exact match for the key
            $exactValue = getSingleSetting($userId, $key);
            
            if ($exactValue !== null) {
                // Key exists, return just this value
                echo json_encode([$key => $exactValue]);
            } else {
                // No exact match, try to get settings with this prefix
                $settingsWithPrefix = getSettingsWithPrefix($userId, $key);
                
                if (!empty($settingsWithPrefix)) {
                    echo json_encode($settingsWithPrefix);
                } else {
                    logMessage("No settings found with key or prefix '$key' for user $userId", "WARNING");
                    http_response_code(404);
                }
            }
        } else {
            // No key provided, return all settings
            $settings = loadUserSettings($userId);
            echo json_encode($settings);
        }
        break;
        
    case 'PUT':
        // PUT request - update or create a setting
        if (!$userId || !validateUserId($userId)) {
            logMessage("Invalid or missing user ID: $userId", "ERROR");
            http_response_code(400);
            exit;
        }
        
        if (!$key) {
            logMessage("Missing key in URL path", "ERROR");
            http_response_code(400);
            exit;
        }
        
        // Validate key length
        if (strlen($key) > $maxKeyLength) {
            logMessage("Key too long: $key", "ERROR");
            http_response_code(400);
            exit;
        }
        
        // Parse the input
        $requestData = json_decode(file_get_contents('php://input'), true);
        
        if (!isset($requestData['value'])) {
            logMessage("Missing value parameter", "ERROR");
            http_response_code(400);
            exit;
        }
        
        $value = $requestData['value'];
        
        // Validate value length
        if (strlen(json_encode($value)) > $maxValueLength) {
            logMessage("Value too long", "ERROR");
            http_response_code(400);
            echo json_encode(['error' => 'Value too long']);
            exit;
        }
        
        // Convert value to boolean if it's a boolean string or already boolean
        if (is_string($value)) {
            if ($value === 'true') {
                $value = true;
            } elseif ($value === 'false') {
                $value = false;
            }
            // Keep other string values as is - this handles non-boolean settings
        }
        
        // Check if this is a new resource creation
        $isCreatingResource = !userSettingsExist($userId);
        
        // Update the single setting instead of all settings
        if (updateSingleSetting($userId, $key, $value)) {
            // Return 201 Created if this was a new resource, otherwise 200 OK
            if ($isCreatingResource) {
                http_response_code(201);
                echo json_encode(['success' => true, 'key' => $key, 'created' => true]);
            } else {
                echo json_encode(['success' => true, 'key' => $key]);
            }
        } else {
            logMessage("Failed to save setting $key for user $userId", "ERROR");
            http_response_code(500);
        }
        break;
        
    default:
        logMessage("Invalid method: $method", "ERROR");
        // Method not allowed
        http_response_code(405);
        break;
}


// ***** Utility Functions *****

// Helper function to initialize or update a user entry in the user_ids table
function initializeUserIdEntry($userId) {
    global $dbConnection;
    logMessage("Initializing or updating user_ids entry for user $userId");
    
    try {
        $currentTime = date('Y-m-d H:i:s');
        
        // First check if the user already exists in the user_ids table
        $checkStmt = $dbConnection->prepare("SELECT 1 FROM user_ids WHERE user_id = ? LIMIT 1");
        $checkStmt->execute([$userId]);
        $userExists = $checkStmt->rowCount() > 0;
        
        if ($userExists) {
            // Update existing user's last_login and increment login_count
            $updateStmt = $dbConnection->prepare("
                UPDATE user_ids 
                SET last_login = ?, login_count = login_count + 1 
                WHERE user_id = ?
            ");
            $updateStmt->execute([$currentTime, $userId]);
            logMessage("Updated login statistics for user $userId");
        } else {
            // Create new user entry with initial values
            $insertStmt = $dbConnection->prepare("
                INSERT INTO user_ids (user_id, initial_login, last_login, login_count) 
                VALUES (?, ?, ?, 1)
            ");
            $insertStmt->execute([$userId, $currentTime, $currentTime]);
            logMessage("Added user $userId to user_ids table with initial login at $currentTime");
        }
        
        return true;
    } catch (PDOException $e) {
        logMessage("Failed to initialize user_ids entry: " . $e->getMessage(), "WARNING");
        // Non-fatal error
        return false;
    }
}

// Helper function to update a single setting
function updateSingleSetting($userId, $key, $value) {
    global $dbConnection;
    logMessage("Updating single setting for user $userId, key: $key");
    
    try {
        $jsonValue = json_encode($value);
        
        // Check if this key already exists for the user
        $checkStmt = $dbConnection->prepare("SELECT 1 FROM user_settings WHERE user_id = ? AND setting_key = ? LIMIT 1");
        $checkStmt->execute([$userId, $key]);
        $exists = $checkStmt->rowCount() > 0;
        
        if ($exists) {
            // Update existing key
            logMessage("Key $key exists, updating it");
            $updateStmt = $dbConnection->prepare("UPDATE user_settings SET setting_value = ? WHERE user_id = ? AND setting_key = ?");
            $updateStmt->execute([$jsonValue, $userId, $key]);
        } else {
            // Insert new key
            logMessage("Key $key does not exist, inserting it");
            $insertStmt = $dbConnection->prepare("INSERT INTO user_settings (user_id, setting_key, setting_value) VALUES (?, ?, ?)");
            $insertStmt->execute([$userId, $key, $jsonValue]);
        }
        
        logMessage("Successfully saved setting $key for user $userId");
        return true;
    } catch (PDOException $e) {
        $errorMsg = "Database error updating setting: " . $e->getMessage();
        logMessage($errorMsg, "ERROR");
        return false;
    }
}

// Helper function to get a single setting value
function getSingleSetting($userId, $key) {
    global $dbConnection;
    logMessage("Getting single setting for user $userId, key: $key");
    
    try {
        // Get the specific key value
        $stmt = $dbConnection->prepare("SELECT setting_value FROM user_settings WHERE user_id = ? AND setting_key = ?");
        $stmt->execute([$userId, $key]);
        
        if ($stmt->rowCount() > 0) {
            $row = $stmt->fetch();
            $value = json_decode($row['setting_value'], true);
            logMessage("Found setting $key for user $userId");
            return $value !== null ? $value : $row['setting_value'];
        } else {
            logMessage("Setting $key not found for user $userId", "WARNING");
            return null;
        }
    } catch (PDOException $e) {
        $errorMsg = "Database error getting setting: " . $e->getMessage();
        logMessage($errorMsg, "ERROR");
        throw $e;
    }
}

// Helper function to get settings with a prefix
function getSettingsWithPrefix($userId, $keyPrefix) {
    global $dbConnection;
    logMessage("Getting settings with prefix '$keyPrefix' for user $userId");
    
    try {
        $stmt = $dbConnection->prepare("SELECT setting_key, setting_value FROM user_settings WHERE user_id = ? AND setting_key LIKE ?");
        $stmt->execute([$userId, $keyPrefix . '%']);
        
        $settings = [];
        while ($row = $stmt->fetch()) {
            $value = json_decode($row['setting_value'], true);
            $settings[$row['setting_key']] = $value !== null ? $value : $row['setting_value'];
        }
        
        logMessage("Found " . count($settings) . " setting(s) with prefix '$keyPrefix' for user $userId");
        return $settings;
    } catch (PDOException $e) {
        $errorMsg = "Database error getting settings with prefix: " . $e->getMessage();
        logMessage($errorMsg, "ERROR");
        throw $e;
    }
}

// Helper function to validate user ID
function validateUserId($userId) {
    $isValid = (strlen($userId) >= 9) && preg_match('/^[a-zA-Z0-9_-]+$/', $userId);
    logMessage("Validating user ID: $userId - " . ($isValid ? "Valid" : "Invalid"));
    return $isValid;
}

// Helper function to check if user settings exist
function userSettingsExist($userId) {
    global $dbConnection;
    
    try {
        logMessage("Checking if user $userId exists in database");
        $stmt = $dbConnection->prepare("SELECT 1 FROM user_settings WHERE user_id = ? LIMIT 1");
        $stmt->execute([$userId]);
        $exists = $stmt->rowCount() > 0;
        logMessage("Database check result: " . ($exists ? "User exists" : "User does not exist"));
        return $exists;
    } catch (PDOException $e) {
        $errorMsg = "Database error checking if user settings exist: " . $e->getMessage();
        logMessage($errorMsg, "ERROR");
        throw $e; // Rethrow the exception after logging
    }
}

// Helper function to load user settings
function loadUserSettings($userId) {
    global $dbConnection, $defaultSettings;
    logMessage("Loading settings for user $userId");
    
    try {
        logMessage("Loading settings from database for $userId");
        $settings = [];
        $stmt = $dbConnection->prepare("SELECT setting_key, setting_value FROM user_settings WHERE user_id = ?");
        $stmt->execute([$userId]);
        $rowCount = $stmt->rowCount();
        logMessage("Found $rowCount setting(s) in database for user $userId");
        
        if ($rowCount > 0) {
            while ($row = $stmt->fetch()) {
                // Parse stored JSON value or use as is if parsing fails
                $value = json_decode($row['setting_value'], true);
                $settings[$row['setting_key']] = ($value !== null) ? $value : $row['setting_value'];
                logMessage("Loaded setting {$row['setting_key']} from database with value type: " . gettype($value));
            }
            return $settings;
        }
        
        // If no settings in DB but this was called, create default settings
        logMessage("No settings found in database, saving defaults", "WARNING");
        saveUserSettings($userId, $defaultSettings);
        return $defaultSettings;
    } catch (PDOException $e) {
        $errorMsg = "Database error loading user settings: " . $e->getMessage();
        logMessage($errorMsg, "ERROR");
        throw $e; // Rethrow the exception after logging
    }
}

// Helper function to save user settings
function saveUserSettings($userId, $settings) {
    global $dbConnection;
    logMessage("Saving settings for user $userId - " . count($settings) . " setting(s)");
    
    try {
        logMessage("Saving settings to database");
        $dbConnection->beginTransaction();
        
        // Delete existing settings for this user
        $deleteStmt = $dbConnection->prepare("DELETE FROM user_settings WHERE user_id = ?");
        $deleteStmt->execute([$userId]);
        $deletedCount = $deleteStmt->rowCount();
        logMessage("Deleted $deletedCount existing setting(s) for user $userId");
        
        // Insert new settings
        $insertStmt = $dbConnection->prepare("INSERT INTO user_settings (user_id, setting_key, setting_value) VALUES (?, ?, ?)");
        $insertCount = 0;
        
        foreach ($settings as $key => $value) {
            $jsonValue = json_encode($value);
            $insertStmt->execute([$userId, $key, $jsonValue]);
            $insertCount++;
            logMessage("Inserted setting: $key with value type: " . gettype($value));
        }
        
        $dbConnection->commit();
        logMessage("Database transaction committed successfully - inserted $insertCount setting(s)");
        return true;
    } catch (PDOException $e) {
        $dbConnection->rollBack();
        $errorMsg = "Database error saving user settings: " . $e->getMessage();
        logMessage($errorMsg, "ERROR");
        return false;
    }
}

// Simple logging function
function logMessage($message, $level = 'INFO') {
    global $logFile;
    $timestamp = date('Y-m-d H:i:s');
    $formattedMessage = "[$timestamp] [$level] $message" . PHP_EOL;
    file_put_contents($logFile, $formattedMessage, FILE_APPEND);
}
