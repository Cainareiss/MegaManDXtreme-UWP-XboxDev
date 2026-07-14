$ErrorActionPreference = 'Stop'

$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourcePath = Join-Path $workspace 'GameFiles\Dialogues.xml'
$outputDir = Join-Path $workspace 'Translation\Story_EN'

[xml]$document = [System.IO.File]::ReadAllText($sourcePath)
$entries = [System.Collections.Generic.List[object]]::new()
$dialogueCount = 0
$duplicateLineIds = 0

foreach ($dialogue in @($document.D.Dialogue)) {
    $dialogueCount++
    $dialogueId = $dialogue.GetAttribute('id')
    $lineOccurrences = @{}

    foreach ($line in @($dialogue.TextLine)) {
        $lineId = $line.GetAttribute('id')
        $sourceKey = "$dialogueId|$lineId"
        $occurrence = 1
        if ($lineOccurrences.ContainsKey($sourceKey)) {
            $occurrence = $lineOccurrences[$sourceKey] + 1
            $duplicateLineIds++
        }
        $lineOccurrences[$sourceKey] = $occurrence
        $stableSource = "$sourceKey|$occurrence"
        $sha1 = [System.Security.Cryptography.SHA1]::Create()
        try {
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($stableSource)
            $hash = ([System.BitConverter]::ToString(
                $sha1.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
        }
        finally {
            $sha1.Dispose()
        }

        $entries.Add([pscustomobject][ordered]@{
            id = "dialogue_$($hash.Substring(0, 12))"
            dialogue = $dialogueId
            line = $lineId
            occurrence = $occurrence
            speaker = $line.GetAttribute('name')
            english = ([string]$line.InnerText).Trim()
            portuguese = ''
            notes = ''
        })
    }
}

[System.IO.Directory]::CreateDirectory($outputDir) | Out-Null

$jsonDocument = [ordered]@{
    formatVersion = 1
    source = 'GameFiles/Dialogues.xml'
    generatedAt = [DateTime]::UtcNow.ToString('o')
    dialogueCount = $dialogueCount
    lineCount = $entries.Count
    duplicateLineIds = $duplicateLineIds
    entries = $entries
}
$json = $jsonDocument | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText(
    (Join-Path $outputDir 'dialogues_en.json'),
    $json + [Environment]::NewLine,
    [System.Text.UTF8Encoding]::new($false))

$csv = $entries |
    Select-Object id, dialogue, line, occurrence, speaker, english,
        portuguese, notes |
    ConvertTo-Csv -NoTypeInformation
[System.IO.File]::WriteAllLines(
    (Join-Path $outputDir 'dialogues_en.csv'),
    $csv,
    [System.Text.UTF8Encoding]::new($true))

$text = [System.Text.StringBuilder]::new()
foreach ($entry in $entries) {
    [void]$text.AppendLine(
        "[$($entry.id)] $($entry.dialogue) / linha $($entry.line) / ocorrencia $($entry.occurrence) / $($entry.speaker)")
    [void]$text.AppendLine($entry.english)
    [void]$text.AppendLine()
    [void]$text.AppendLine('PT-BR:')
    [void]$text.AppendLine()
    [void]$text.AppendLine(('=' * 72))
}
[System.IO.File]::WriteAllText(
    (Join-Path $outputDir 'dialogues_en.txt'),
    $text.ToString(),
    [System.Text.UTF8Encoding]::new($false))

Write-Output "DIALOGUES=$dialogueCount"
Write-Output "LINES=$($entries.Count)"
Write-Output "DUPLICATE_LINE_IDS=$duplicateLineIds"
Write-Output "OUTPUT=$outputDir"
