package translator

import (
	"encoding/json"
	"os"
	"path/filepath"
)

func readSnapshotTiming(snapshotsDir string, index int) *SnapshotTiming {
	if index < 0 {
		return nil
	}
	path := filepath.Join(snapshotsDir, "snapshot_"+padIndex(index)+".meta.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var timing SnapshotTiming
	if err := json.Unmarshal(data, &timing); err != nil {
		return nil
	}
	return &timing
}

// buildTemporalEvidence 以 action 事件时间为边界，关联前后两张 AX 快照的实际采样时间窗。
// 旧录制数据没有 .meta.json 时返回不完整证据，不影响原有快照 diff 与翻译流程。
func buildTemporalEvidence(
	snapshotsDir string,
	action mergedAction,
	previousTimestamp int64,
	nextTimestamp int64,
	fallbackIndex int,
) *TemporalEvidence {
	preIndex := fallbackIndex - 1
	if action.PreSnapshotIndex != nil {
		preIndex = *action.PreSnapshotIndex
	}
	postIndex := fallbackIndex
	if action.PostSnapshotIndex != nil {
		postIndex = *action.PostSnapshotIndex
	}

	evidence := &TemporalEvidence{
		EventTimestamp:         action.Timestamp,
		PreviousEventTimestamp: previousTimestamp,
		NextEventTimestamp:     nextTimestamp,
		PreSnapshot:            readSnapshotTiming(snapshotsDir, preIndex),
		PostSnapshot:           readSnapshotTiming(snapshotsDir, postIndex),
	}
	if previousTimestamp > 0 && action.Timestamp >= previousTimestamp {
		interval := action.Timestamp - previousTimestamp
		evidence.IntervalFromPreviousMs = &interval
	}
	if evidence.PreSnapshot != nil {
		evidence.PreSnapshotCompletedBeforeEvent =
			evidence.PreSnapshot.CaptureCompletedAt > 0 &&
				evidence.PreSnapshot.CaptureCompletedAt <= action.Timestamp
	}
	if evidence.PostSnapshot != nil {
		evidence.PostSnapshotBoundaryStatus = evidence.PostSnapshot.BoundaryStatus
		if nextTimestamp > 0 {
			evidence.PostSnapshotInsideOperationInterval =
				evidence.PostSnapshot.CaptureStartedAt >= action.Timestamp &&
					evidence.PostSnapshot.CaptureCompletedAt > 0 &&
					evidence.PostSnapshot.CaptureCompletedAt <= nextTimestamp
		} else {
			evidence.PostSnapshotInsideOperationInterval =
				evidence.PostSnapshot.Role == "final" &&
					evidence.PostSnapshot.CaptureStartedAt >= action.Timestamp &&
					evidence.PostSnapshot.BoundaryStatus == "after_last_action"
		}
	}
	return evidence
}
