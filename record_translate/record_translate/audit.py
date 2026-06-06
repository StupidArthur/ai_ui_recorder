"""LLM 请求/响应全量审计"""

from __future__ import annotations

import json
from pathlib import Path

from .client import LLMClient
from .config import LLM_AUDIT_SUBDIR
from .config import load_ai_config


class LlmAudit:
    """LLM 审计会话（绑定一次 translate run）"""

    def __init__(self, run_dir: Path, client: LLMClient, log=None):
        self.audit_dir = run_dir / LLM_AUDIT_SUBDIR
        self.audit_dir.mkdir(parents=True, exist_ok=True)
        self._client = client
        self._log = log
        self._entries: list[dict] = []
        self._seq = 0

        config = load_ai_config()
        self._model = config.get("model", "")

    async def call(
        self,
        meta: dict,
        messages: list[dict[str, str]],
        chat_options: dict | None = None,
    ) -> tuple[str, str]:
        """
        调用 LLM 并写入审计记录。

        meta: {"phase": "phase1", "label": "batch 1~3", "extra": {...}}
        返回: (call_id, raw_reply)
        """
        opts = chat_options or {}
        call_id = self._begin_call(meta)

        # 写入请求
        self._patch_call(call_id, {
            "request": {
                "model": opts.get("model", self._model),
                "temperature": opts.get("temperature"),
                "maxTokens": opts.get("max_tokens"),
                "messages": messages,
            }
        })

        try:
            raw = await self._client.call_chat(
                messages,
                temperature=opts.get("temperature", 0.2),
                max_tokens=opts.get("max_tokens", 2000),
                model=opts.get("model"),
            )
            self._patch_call(call_id, {
                "finishedAt": self._now_iso(),
                "response": {"raw": raw},
            })
            return call_id, raw
        except Exception as e:
            self._patch_call(call_id, {
                "finishedAt": self._now_iso(),
                "response": {"error": str(e)},
            })
            self.mark_outcome(call_id, {
                "ok": False,
                "problems": [f"API 调用失败: {e}"],
            })
            raise

    def mark_outcome(self, call_id: str, outcome: dict) -> None:
        """标记调用结果"""
        self._patch_call(call_id, {"outcome": outcome})
        entry = next((e for e in self._entries if e["id"] == call_id), None)
        if entry:
            entry["ok"] = bool(outcome.get("ok"))
            entry["problems"] = outcome.get("problems", [])
            if "details" in outcome:
                entry["details"] = outcome["details"]
        self._flush_index()

    def finalize(self) -> dict:
        """写出 problems.json / summary.json"""
        problems = [e for e in self._entries if e.get("ok") is False]
        pending = [e for e in self._entries if e.get("ok") is None]

        for entry in pending:
            entry["ok"] = False
            entry["problems"] = ["未标记 outcome（调用方遗漏 markOutcome）"]

        self._flush_index()

        problems_path = self.audit_dir / "problems.json"
        problems_path.write_text(json.dumps(problems, ensure_ascii=False, indent=2), "utf-8")

        summary = {
            "totalCalls": len(self._entries),
            "okCalls": sum(1 for e in self._entries if e.get("ok") is True),
            "problemCalls": sum(1 for e in self._entries if e.get("ok") is False),
            "auditDir": str(self.audit_dir),
            "indexFile": str(self.audit_dir / "index.json"),
            "problemsFile": str(problems_path),
        }
        (self.audit_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), "utf-8")

        if self._log:
            self._log.info(f"[LLM Audit] 共 {summary['totalCalls']} 次调用，{summary['problemCalls']} 次有问题")

        return summary

    # ==================== 内部方法 ====================

    def _begin_call(self, meta: dict) -> str:
        self._seq += 1
        call_id = f"call_{self._seq:04d}"
        record = {
            "id": call_id,
            "phase": meta.get("phase", ""),
            "label": meta.get("label", ""),
            "extra": meta.get("extra", {}),
            "startedAt": self._now_iso(),
            "finishedAt": None,
            "request": None,
            "response": None,
            "outcome": None,
        }
        self._write_call_file(call_id, record)
        self._entries.append({
            "id": call_id,
            "phase": meta.get("phase", ""),
            "label": meta.get("label", ""),
            "ok": None,
            "problems": [],
            "file": f"{call_id}.json",
        })
        self._flush_index()
        return call_id

    def _patch_call(self, call_id: str, patch: dict) -> None:
        record = self._read_call_file(call_id)
        record.update(patch)
        self._write_call_file(call_id, record)

    def _write_call_file(self, call_id: str, record: dict) -> None:
        (self.audit_dir / f"{call_id}.json").write_text(
            json.dumps(record, ensure_ascii=False, indent=2), "utf-8"
        )

    def _read_call_file(self, call_id: str) -> dict:
        return json.loads((self.audit_dir / f"{call_id}.json").read_text("utf-8"))

    def _flush_index(self) -> None:
        (self.audit_dir / "index.json").write_text(
            json.dumps(self._entries, ensure_ascii=False, indent=2), "utf-8"
        )

    @staticmethod
    def _now_iso() -> str:
        from datetime import datetime, timezone
        return datetime.now(timezone.utc).isoformat()
