param(
  [Parameter(Mandatory)] [string]$Output,
  [int]$Rate = -1,
  [string]$Text = 'Bonjour tout le monde. Ceci est un test de lecture. Nous parlons de la voix française. Merci de votre attention.'
)
$voice = New-Object -ComObject SAPI.SpVoice
$french = $voice.GetVoices() | Where-Object { $_.GetAttribute('Language').Split(';') -contains '40C' } | Select-Object -First 1
if (!$french) { throw 'La voix synthétique française Microsoft doit être installée pour le test vocal.' }
$voice.Voice = $french
$voice.Rate = $Rate
$stream = New-Object -ComObject SAPI.SpFileStream
$stream.Format.Type = 18
$stream.Open($Output, 3, $false)
try {
  $voice.AudioOutputStream = $stream
  $voice.Speak($Text) | Out-Null
} finally {
  $stream.Close()
}
