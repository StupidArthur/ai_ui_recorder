package translator

import (
	"strings"
	"testing"
)

func TestComputeDiffWithContext(t *testing.T) {
	pre := "group 推荐问题\nswitch [unchecked]\ntext 其他设置\n"
	post := "group 推荐问题\nswitch [checked]\ntext 其他设置\n"

	diff := computeDiff(pre, post)
	if !strings.Contains(diff, "推荐问题") {
		t.Fatalf("diff 未保留变化行的控件上下文:\n%s", diff)
	}
	if !strings.Contains(diff, "- switch [unchecked]") {
		t.Fatalf("diff 未包含 switch 删除行:\n%s", diff)
	}
	if !strings.Contains(diff, "+ switch [checked]") {
		t.Fatalf("diff 未包含 switch 新增行:\n%s", diff)
	}
}
