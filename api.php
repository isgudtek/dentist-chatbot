<?php
// api.php
require_once 'config.php';

error_reporting(0);
header('Content-Type: application/json');

$input = json_decode(file_get_contents('php://input'), true);

if (!$input || !isset($input['messages'])) {
    echo json_encode(['error' => 'Invalid input']);
    exit;
}

$tools = [
    [
        'type' => 'function',
        'function' => [
            'name' => 'get_calendar_events',
            'description' => 'Get upcoming dental appointments from the calendar.',
            'parameters' => [
                'type' => 'object',
                'properties' => (object)[]
            ]
        ]
    ],
    [
        'type' => 'function',
        'function' => [
            'name' => 'create_reservation',
            'description' => 'Create a new dental reservation in the calendar.',
            'parameters' => [
                'type' => 'object',
                'properties' => [
                    'title' => [
                        'type' => 'string',
                        'description' => 'The title of the reservation (e.g., Checkup for John Doe)'
                    ],
                    'startTime' => [
                        'type' => 'string',
                        'description' => 'ISO 8601 start time'
                    ],
                    'endTime' => [
                        'type' => 'string',
                        'description' => 'ISO 8601 end time'
                    ],
                    'description' => [
                        'type' => 'string',
                        'description' => 'Optional description'
                    ]
                ],
                'required' => ['title', 'startTime', 'endTime']
            ]
        ]
    ]
];

$ch = curl_init('https://api.openai.com/v1/chat/completions');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
    'model' => 'gpt-4o',
    'messages' => $input['messages'],
    'tools' => $tools,
    'tool_choice' => 'auto',
    'temperature' => 0.7
]));
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    'Authorization: Bearer ' . OPENAI_API_KEY
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

http_response_code($httpCode);
echo $response;
exit;
?>
