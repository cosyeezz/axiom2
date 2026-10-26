# STA companion for native copy-button tests. All original clipboard data remains in RAM.
# Never print original clipboard text or serialize it to a file.
$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
$original=[Windows.Forms.DataObject]::new()
$backupComplete=$true
$source=[Windows.Forms.Clipboard]::GetDataObject()
if($null -ne $source){foreach($format in $source.GetFormats($false)){try{$value=$source.GetData($format,$false);$original.SetData($format,$false,$value)}catch{$backupComplete=$false}}}
function TextHash {
 $text=[Windows.Forms.Clipboard]::GetText()
 $sha=[Security.Cryptography.SHA256]::Create()
 try {return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($text)))).Replace('-','').ToLowerInvariant()} finally {$sha.Dispose()}
}
[Console]::WriteLine((@{ready=$true;backupComplete=$backupComplete}|ConvertTo-Json -Compress))
while($null -ne ($line=[Console]::ReadLine())){
 try{
  $request=$line|ConvertFrom-Json
  if($request.command -eq 'hash'){[Console]::WriteLine((@{id=$request.id;ok=$true;hash=(TextHash)}|ConvertTo-Json -Compress))}
  elseif($request.command -eq 'restore'){
   $restored=$false
   if($backupComplete -and (TextHash) -eq $request.expectedHash){[Windows.Forms.Clipboard]::SetDataObject($original,$true);$restored=$true}
   [Console]::WriteLine((@{id=$request.id;ok=$true;restored=$restored;reason=if($restored){'original RAM backup restored'}else{'clipboard changed externally or backup incomplete; no overwrite'}}|ConvertTo-Json -Compress))
  }elseif($request.command -eq 'stop'){[Console]::WriteLine((@{id=$request.id;ok=$true}|ConvertTo-Json -Compress));break}
  else{throw 'Unsupported clipboard test operation'}
 }catch{[Console]::WriteLine((@{id=$request.id;ok=$false;error='clipboard operation failed'}|ConvertTo-Json -Compress))}
}
