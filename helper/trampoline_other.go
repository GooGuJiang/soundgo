// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 SoundGo contributors

//go:build !windows

package main

func maybeRunWindowsTrampoline(_ []string) (bool, error) {
	return false, nil
}

func watchParentExit(_ int, _ func()) {}
