package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestComputeDiffWithContext 验证改进后的 computeDiff 在 switch 变化行周围保留了上下文行（开关名称）。
func TestComputeDiffWithContext(t *testing.T) {
	runDir := `G:\github\ai_ui_recorder\release\recorder\output\run_2026-06-23T02-35-19\record`

	cases := []struct {
		idx          int
		expectSwitch string
	}{
		{8, `推荐问题`},
		{9, `显示所有对话过程`},
	}

	for _, c := range cases {
		pre, err1 := os.ReadFile(filepath.Join(runDir, "snapshots", "snapshot_"+padIndex(c.idx-1)+".txt"))
		post, err2 := os.ReadFile(filepath.Join(runDir, "snapshots", "snapshot_"+padIndex(c.idx)+".txt"))
		if err1 != nil || err2 != nil {
			t.Fatalf("读 snapshot_%d 失败: %v / %v", c.idx, err1, err2)
		}
		diff := computeDiff(string(pre), string(post))
		t.Logf("===== 步骤 %d diff（期望含开关名「%s」）=====", c.idx, c.expectSwitch)
		t.Logf("%s", diff)

		if !strings.Contains(diff, c.expectSwitch) {
			t.Errorf("步骤 %d diff 未包含开关名「%s」", c.idx, c.expectSwitch)
		} else {
			t.Logf("✓ 步骤 %d diff 已包含开关名「%s」", c.idx, c.expectSwitch)
		}

		if !strings.Contains(diff, "switch [checked]") && !strings.Contains(diff, "switch [unchecked]") {
			t.Errorf("步骤 %d diff 未包含 switch 变化行", c.idx)
		}
	}
}
