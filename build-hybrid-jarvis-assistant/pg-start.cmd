@echo off
rem Starts the embedded PostgreSQL server (non-elevated).
cd /d "%~dp0"
"node_modules\@embedded-postgres\windows-x64\native\bin\postgres.exe" -D .pgdata -p 5432 -c listen_addresses=127.0.0.1
