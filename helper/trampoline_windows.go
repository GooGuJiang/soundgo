// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 SoundGo contributors

//go:build windows

package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

const (
	winSynchronize     = 0x00100000
	winInfinite        = 0xFFFFFFFF
	winCreateNoWindow  = 0x08000000
	winDetachedProcess = 0x00000008
)

var (
	kernel32                 = syscall.NewLazyDLL("kernel32.dll")
	procOpenProcess          = kernel32.NewProc("OpenProcess")
	procWaitForSingleObject  = kernel32.NewProc("WaitForSingleObject")
	procCloseHandle          = kernel32.NewProc("CloseHandle")
)

// maybeRunWindowsTrampoline copies bin/hls-helper.exe into %TEMP% and launches
// it from there with --worker --ppid <parent>, then prints the worker's ready
// JSON line and exits immediately. That ensures no running process holds a
// Windows file or working-directory lock inside the plugin directory, so
// MyGo Music can rename/update or remove the plugin folder at any time.
func maybeRunWindowsTrampoline(args []string) (handled bool, err error) {
	for _, arg := range args {
		if arg == "--worker" {
			return false, nil
		}
	}

	exe, err := os.Executable()
	if err != nil {
		return false, nil
	}
	tempDir := os.TempDir()
	// Already running inside temp dir (e.g. go test binary); run directly.
	if rel, relErr := filepath.Rel(tempDir, exe); relErr == nil && !strings.HasPrefix(rel, "..") {
		return false, nil
	}

	workerPath, err := stageTempBinary(exe, tempDir)
	if err != nil {
		return false, err
	}

	ppid := os.Getppid()
	cmd := exec.Command(workerPath, "--worker", "--ppid", strconv.Itoa(ppid))
	cmd.Dir = tempDir
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: winCreateNoWindow | winDetachedProcess,
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return true, err
	}
	if err := cmd.Start(); err != nil {
		return true, err
	}

	reader := bufio.NewReader(stdout)
	line, err := reader.ReadString('\n')
	if err != nil && len(line) == 0 {
		_ = cmd.Process.Kill()
		return true, fmt.Errorf("worker failed to start: %w", err)
	}
	_ = stdout.Close()

	_, _ = os.Stdout.WriteString(line)
	_ = os.Stdout.Sync()
	// Release the handle without waiting; the worker watches ppid directly.
	_ = cmd.Process.Release()
	return true, nil
}

func stageTempBinary(src, tempDir string) (string, error) {
	info, err := os.Stat(src)
	if err != nil {
		return "", err
	}

	f, err := os.Open(src)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		_ = f.Close()
		return "", err
	}
	_ = f.Close()

	tag := hex.EncodeToString(h.Sum(nil))[:16]
	dst := filepath.Join(tempDir, fmt.Sprintf("soundgo-hls-helper-%s.exe", tag))
	if existing, err := os.Stat(dst); err == nil && existing.Size() == info.Size() {
		return dst, nil
	}

	tmp, err := os.CreateTemp(tempDir, "soundgo-hls-helper-*.tmp")
	if err != nil {
		return "", err
	}
	tmpPath := tmp.Name()

	in, err := os.Open(src)
	if err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
		return "", err
	}
	if _, err := io.Copy(tmp, in); err != nil {
		_ = in.Close()
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
		return "", err
	}
	_ = in.Close()
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return "", err
	}

	if err := os.Rename(tmpPath, dst); err != nil {
		// Another concurrent launch may already have staged the identical file.
		if existing, statErr := os.Stat(dst); statErr == nil && existing.Size() == info.Size() {
			_ = os.Remove(tmpPath)
			return dst, nil
		}
		_ = os.Remove(tmpPath)
		return "", err
	}
	return dst, nil
}

// watchParentExit invokes onExit as soon as the given parent PID terminates.
func watchParentExit(ppid int, onExit func()) {
	if ppid <= 0 {
		return
	}
	go func() {
		handle, _, err := procOpenProcess.Call(uintptr(winSynchronize), 0, uintptr(uint32(ppid)))
		if handle == 0 {
			// ERROR_INVALID_PARAMETER (87) means the parent PID no longer exists.
			if errno, ok := err.(syscall.Errno); ok && errno == 87 {
				onExit()
			}
			return
		}
		defer procCloseHandle.Call(handle)
		_, _, _ = procWaitForSingleObject.Call(handle, uintptr(winInfinite))
		onExit()
	}()
}
