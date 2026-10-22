$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class CR2 {
 [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool CredRead(string target,int type,int flags,out IntPtr credential);
 [DllImport("advapi32.dll", SetLastError=true)] static extern void CredFree(IntPtr buffer);
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct C { public uint Flags; public uint Type; public string TargetName; public string Comment; public long LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist; public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
 public static string Read(string target){ IntPtr p; if(!CredRead(target,1,0,out p)) throw new Exception("read"); try { C c=(C)Marshal.PtrToStructure(p,typeof(C)); byte[] b=new byte[c.CredentialBlobSize]; Marshal.Copy(c.CredentialBlob,b,0,b.Length); return Encoding.UTF8.GetString(b);} finally { CredFree(p);} }
}
"@
$token=[CR2]::Read('GitHub - https://api.github.com/TK9BOT')
$r=Invoke-WebRequest -Uri 'https://api.github.com/user' -Headers @{Authorization='Bearer '+$token; 'User-Agent'='dsh-move-audit'} -UseBasicParsing
Write-Output ('LOGIN=' + ($r.Content | ConvertFrom-Json).login)
Write-Output ('SCOPES=' + $r.Headers['x-oauth-scopes'])
$repo=Invoke-WebRequest -Uri 'https://api.github.com/repos/TK9BOT/dsh-move' -Headers @{Authorization='Bearer '+$token; 'User-Agent'='dsh-move-audit'} -UseBasicParsing
$j=$repo.Content | ConvertFrom-Json
Write-Output ('PERMISSIONS=' + ($j.permissions | ConvertTo-Json -Compress))
Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue
