@echo off
chcp 65001 >nul
call "%HELIX_WINDOWS_VSDEVCMD%" -no_logo -arch=%HELIX_WINDOWS_NATIVE_ARCH% -host_arch=%HELIX_WINDOWS_NATIVE_ARCH%
if errorlevel 1 exit /b 1
echo HELIX_WINDOWS_NATIVE_ENVIRONMENT
set
