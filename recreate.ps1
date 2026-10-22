$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class CR3 {
 [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool CredRead(string target,int type,int flags,out IntPtr credential);
 [DllImport("advapi32.dll", SetLastError=true)] static extern void CredFree(IntPtr buffer);
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct C { public uint Flags; public uint Type; public string TargetName; public string Comment; public long LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist; public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
 public static string Read(string target){ IntPtr p; if(!CredRead(target,1,0,out p)) throw new Exception("credential read failed"); try { C c=(C)Marshal.PtrToStructure(p,typeof(C)); byte[] b=new byte[c.CredentialBlobSize]; Marshal.Copy(c.CredentialBlob,b,0,b.Length); return Encoding.UTF8.GetString(b);} finally { CredFree(p);} }
}
"@
$token=[CR3]::Read('GitHub - https://api.github.com/TK9BOT')
$headers=@{Authorization='Bearer '+$token; 'User-Agent'='dsh-move-audit'; 'Accept'='application/vnd.github+json'}
function Api($method,$uri,$body) {
  if ($null -ne $body) { Invoke-RestMethod -Method $method -Uri $uri -Headers $headers -Body ($body | ConvertTo-Json) -ContentType 'application/json' -Proxy 'http://127.0.0.1:7897' -UseBasicParsing }
  else { Invoke-RestMethod -Method $method -Uri $uri -Headers $headers -Proxy 'http://127.0.0.1:7897' -UseBasicParsing }
}
$old=Api 'GET' 'https://api.github.com/repos/TK9BOT/dsh-move' $null
Write-Output ('OLD=' + $old.full_name)
$renamed=Api 'PATCH' 'https://api.github.com/repos/TK9BOT/dsh-move' @{ name='dsh-move-archive-private'; private=$true; description='Archived private copy retained only to remove a personal path from public history.' }
Write-Output ('RENAMED=' + $renamed.full_name + ' PRIVATE=' + $renamed.private)
$new=Api 'POST' 'https://api.github.com/user/repos' @{ name='dsh-move'; private=$false; has_issues=$true; has_projects=$false; has_wiki=$false; auto_init=$false; description='Bilingual native DSH backup and migration plugin: workspaces, sessions, attachments, plugins, skills, MCP and settings in one archive.' }
Write-Output ('NEW=' + $new.full_name + ' PRIVATE=' + $new.private + ' URL=' + $new.html_url)
Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue
