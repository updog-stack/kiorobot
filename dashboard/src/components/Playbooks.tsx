import { useEffect, useMemo, useState } from "react";
import {
  fetchPlaybooks,
  savePlaybooks,
  generatePlaybooks,
  uploadImage,
  youtubeId,
  type Playbook,
  type PlaybooksData,
  type PbNode,
  type MediaItem,
} from "../lib/playbooks";

type Mode = "list" | "guide" | "edit";

export function Playbooks() {
  const [data, setData] = useState<PlaybooksData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("list");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [days, setDays] = useState(60); // AI 분석 기간

  useEffect(() => {
    fetchPlaybooks()
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);

  const current = useMemo(
    () => data?.playbooks.find((p) => p.id === currentId) ?? null,
    [data, currentId]
  );

  async function persist(next: PlaybooksData) {
    setData(next);
    try {
      await savePlaybooks(next);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    setInfo(null);
    setError(null);
    try {
      const { added, data: next, basis } = await generatePlaybooks(days);
      setData(next);
      let msg = `AI가 플레이북 ${added}개를 생성했습니다.`;
      if (basis) {
        const topics = basis.topics
          .slice(0, 6)
          .map((t) => `${t.tag}(${t.count}건)`)
          .join(" · ");
        const scope = basis.sampled
          ? `최근 ${basis.days}일 상담 ${basis.totalChats}건 중 ${basis.sampled}건을 AI가 읽고 분류`
          : `최근 ${basis.days}일 상담 ${basis.totalChats}건 분석`;
        msg += ` — 기준: ${scope}. 자주 나온 주제 [${topics}]`;
      }
      setInfo(msg);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setGenerating(false);
    }
  }

  function newPlaybook() {
    if (!data) return;
    const id = `pb-${Date.now()}`;
    const pb: Playbook = {
      id,
      title: "새 플레이북",
      category: "기타",
      rootId: "n1",
      nodes: { n1: { id: "n1", text: "질문을 입력하세요", options: [] } },
    };
    persist({ playbooks: [pb, ...data.playbooks] });
    setCurrentId(id);
    setMode("edit");
  }

  function deletePlaybook(id: string) {
    if (!data) return;
    if (!confirm("이 플레이북을 삭제할까요?")) return;
    persist({ playbooks: data.playbooks.filter((p) => p.id !== id) });
    setMode("list");
  }

  if (error && !data) return <div className="state state--error">불러오기 실패: {error}</div>;
  if (!data) return <div className="state">꿀팁게시판을 불러오는 중…</div>;

  if (mode === "guide" && current) {
    return <Guide playbook={current} onExit={() => setMode("list")} onEdit={() => setMode("edit")} />;
  }
  if (mode === "edit" && current) {
    return (
      <Editor
        playbook={current}
        onCancel={() => setMode("list")}
        onSave={(pb) =>
          persist({ playbooks: data.playbooks.map((p) => (p.id === pb.id ? pb : p)) }).then(() => setMode("list"))
        }
        onDelete={() => deletePlaybook(current.id)}
      />
    );
  }

  // 목록
  return (
    <div className="sales">
      <div className="sales__toolbar">
        <span className="sales__updated">상담 가이드 · 선택지를 따라가며 응대하세요</span>
        <select
          className="pb-period"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          disabled={generating}
          title="AI 분석 기간"
        >
          <option value={30}>최근 30일</option>
          <option value={60}>최근 60일</option>
          <option value={90}>최근 90일</option>
          <option value={180}>최근 180일</option>
        </select>
        <button className="check-btn" onClick={handleGenerate} disabled={generating}>
          {generating ? "AI 생성 중…(수십 초)" : "🤖 AI로 초안 생성"}
        </button>
        <button className="sync-btn" onClick={newPlaybook}>+ 새 플레이북</button>
      </div>

      <div className="pb-criteria">
        🤖 <b>AI 생성 기준</b>: 태그가 없어도 됩니다. 선택한 기간의 채널톡 상담 <b>내용을 AI가 직접 읽고</b>{" "}
        비슷한 문의끼리 주제로 분류해, 자주 반복되는 주제만 플레이북으로 만듭니다. 일회성 문의는 제외됩니다.
      </div>

      {error && <div className="state state--error">{error}</div>}
      {info && <div className="state pb-info">{info}</div>}

      <div className="pb-grid">
        {data.playbooks.map((p) => (
          <div className="pb-card" key={p.id}>
            <div className="pb-card__top">
              <span className="pb-cat">{p.category || "기타"}</span>
              {p.ai && <span className="pb-ai">AI</span>}
            </div>
            <div className="pb-card__title">{p.title}</div>
            <div className="pb-card__meta">{Object.keys(p.nodes).length}단계</div>
            <div className="pb-card__btns">
              <button
                className="sync-btn"
                onClick={() => {
                  setCurrentId(p.id);
                  setMode("guide");
                }}
              >
                ▶ 시작
              </button>
              <button
                className="pb-textbtn"
                onClick={() => {
                  setCurrentId(p.id);
                  setMode("edit");
                }}
              >
                편집
              </button>
            </div>
          </div>
        ))}
        {data.playbooks.length === 0 && (
          <div className="state">플레이북이 없습니다. 'AI로 초안 생성' 또는 '새 플레이북'으로 시작하세요.</div>
        )}
      </div>
    </div>
  );
}

function Guide({ playbook, onExit, onEdit }: { playbook: Playbook; onExit: () => void; onEdit: () => void }) {
  const [path, setPath] = useState<string[]>([playbook.rootId]);
  const nodeId = path[path.length - 1];
  const node: PbNode | undefined = playbook.nodes[nodeId];

  return (
    <div className="sales">
      <div className="sales__toolbar">
        <button className="pb-textbtn" onClick={onExit}>← 목록</button>
        <span className="sales__updated" style={{ marginLeft: "auto" }}>{playbook.title}</span>
        <button className="pb-textbtn" onClick={onEdit}>편집</button>
      </div>

      <section className="card card--wide pb-stage">
        {!node ? (
          <div className="state state--error">노드를 찾을 수 없습니다(연결 오류). 편집에서 확인하세요.</div>
        ) : node.answer ? (
          <div className="pb-answer">
            <div className="pb-answer__tag">✅ 해결 안내</div>
            <div className="pb-answer__text">{node.text}</div>
            <MediaView items={node.media} />
            <div className="pb-stage__btns">
              <button className="sync-btn" onClick={() => setPath([playbook.rootId])}>↺ 처음부터</button>
              <button className="pb-textbtn" onClick={onExit}>상담 종료(목록)</button>
            </div>
          </div>
        ) : (
          <div className="pb-q">
            <div className="pb-q__text">{node.text}</div>
            <MediaView items={node.media} />
            <div className="pb-q__opts">
              {(node.options ?? []).map((o, i) => (
                <button key={i} className="pb-opt" onClick={() => setPath([...path, o.next])} disabled={!playbook.nodes[o.next]}>
                  {o.label}
                  {!playbook.nodes[o.next] && <span className="pb-opt__bad"> (연결 없음)</span>}
                </button>
              ))}
              {(node.options ?? []).length === 0 && <div className="state">선택지가 없습니다.</div>}
            </div>
            {path.length > 1 && (
              <button className="pb-textbtn" onClick={() => setPath(path.slice(0, -1))}>← 이전</button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Editor({
  playbook,
  onCancel,
  onSave,
  onDelete,
}: {
  playbook: Playbook;
  onCancel: () => void;
  onSave: (pb: Playbook) => void;
  onDelete: () => void;
}) {
  const [pb, setPb] = useState<Playbook>(() => JSON.parse(JSON.stringify(playbook)));
  const nodeIds = Object.keys(pb.nodes);

  const setNode = (id: string, patch: Partial<PbNode>) =>
    setPb({ ...pb, nodes: { ...pb.nodes, [id]: { ...pb.nodes[id], ...patch } } });

  function addNode() {
    let i = nodeIds.length + 1;
    while (pb.nodes[`n${i}`]) i++;
    const id = `n${i}`;
    setPb({ ...pb, nodes: { ...pb.nodes, [id]: { id, text: "", options: [] } } });
  }
  function delNode(id: string) {
    if (id === pb.rootId) return alert("루트 노드는 삭제할 수 없습니다.");
    const nodes = { ...pb.nodes };
    delete nodes[id];
    setPb({ ...pb, nodes });
  }

  return (
    <div className="sales">
      <div className="sales__toolbar">
        <button className="pb-textbtn" onClick={onCancel}>← 취소</button>
        <span style={{ marginLeft: "auto" }} />
        <button className="pb-textbtn pb-del" onClick={onDelete}>삭제</button>
        <button className="sync-btn" onClick={() => onSave(pb)}>저장</button>
      </div>

      <section className="card card--wide">
        <div className="pb-edit-row">
          <label>제목<input value={pb.title} onChange={(e) => setPb({ ...pb, title: e.target.value })} /></label>
          <label>분류<input value={pb.category || ""} onChange={(e) => setPb({ ...pb, category: e.target.value })} /></label>
          <label>시작 노드
            <select value={pb.rootId} onChange={(e) => setPb({ ...pb, rootId: e.target.value })}>
              {nodeIds.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          </label>
        </div>
      </section>

      {nodeIds.map((id) => {
        const n = pb.nodes[id];
        return (
          <section className="card card--wide pb-node" key={id}>
            <div className="pb-node__head">
              <b>{id}{id === pb.rootId ? " (시작)" : ""}</b>
              <label className="pb-chk">
                <input type="checkbox" checked={!!n.answer} onChange={(e) => setNode(id, { answer: e.target.checked })} /> 해결책(종료)
              </label>
              <button className="pb-textbtn pb-del" onClick={() => delNode(id)}>노드 삭제</button>
            </div>
            <textarea
              className="pb-textarea"
              value={n.text}
              placeholder={n.answer ? "해결책/안내 문구" : "질문 또는 확인사항"}
              onChange={(e) => setNode(id, { text: e.target.value })}
            />
            {!n.answer && (
              <div className="pb-opts">
                {(n.options ?? []).map((o, i) => (
                  <div className="pb-opt-edit" key={i}>
                    <input
                      placeholder="선택지 텍스트"
                      value={o.label}
                      onChange={(e) => {
                        const options = [...(n.options ?? [])];
                        options[i] = { ...o, label: e.target.value };
                        setNode(id, { options });
                      }}
                    />
                    <span>→</span>
                    <select
                      value={o.next}
                      onChange={(e) => {
                        const options = [...(n.options ?? [])];
                        options[i] = { ...o, next: e.target.value };
                        setNode(id, { options });
                      }}
                    >
                      <option value="">(선택)</option>
                      {nodeIds.map((nid) => <option key={nid} value={nid}>{nid}</option>)}
                    </select>
                    <button className="pb-textbtn pb-del" onClick={() => setNode(id, { options: (n.options ?? []).filter((_, j) => j !== i) })}>✕</button>
                  </div>
                ))}
                <button className="pb-textbtn" onClick={() => setNode(id, { options: [...(n.options ?? []), { label: "", next: "" }] })}>+ 선택지</button>
              </div>
            )}
            <MediaEditor items={n.media ?? []} onChange={(media) => setNode(id, { media })} />
          </section>
        );
      })}

      <button className="sync-btn" onClick={addNode}>+ 노드 추가</button>
    </div>
  );
}

// ===== 자료 보기 (가이드) =====
function MediaView({ items }: { items?: MediaItem[] }) {
  if (!items?.length) return null;
  return (
    <div className="pb-media">
      {items.map((m, i) => {
        if (m.type === "image") {
          return m.value ? (
            <figure className="pb-media__fig" key={i}>
              <img src={m.value} alt={m.caption || ""} loading="lazy" />
              {m.caption && <figcaption>{m.caption}</figcaption>}
            </figure>
          ) : null;
        }
        if (m.type === "youtube") {
          const id = youtubeId(m.value);
          if (!id) return null;
          return (
            <figure className="pb-media__fig pb-media__yt" key={i}>
              <iframe
                src={`https://www.youtube.com/embed/${id}`}
                title={m.caption || "youtube"}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
              {m.caption && <figcaption>{m.caption}</figcaption>}
            </figure>
          );
        }
        return (
          <div className="pb-media__text" key={i}>
            {m.value}
          </div>
        );
      })}
    </div>
  );
}

// ===== 자료 편집 (편집기) =====
function MediaEditor({
  items,
  onChange,
}: {
  items: MediaItem[];
  onChange: (m: MediaItem[]) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const add = (item: MediaItem) => onChange([...items, item]);
  const update = (i: number, patch: Partial<MediaItem>) =>
    onChange(items.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const remove = (i: number) => onChange(items.filter((_, j) => j !== i));

  async function onUpload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        const url = await uploadImage(f);
        add({ type: "image", value: url });
      }
    } catch (e) {
      alert(`업로드 실패: ${e instanceof Error ? e.message : e}`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="pb-media-edit">
      <div className="pb-media-edit__label">📎 첨부 자료 (사진 · 유튜브 · 텍스트)</div>
      {items.map((m, i) => (
        <div className="pb-media-edit__item" key={i}>
          <span className="pb-media-edit__type">
            {m.type === "image" ? "🖼" : m.type === "youtube" ? "▶" : "📝"}
          </span>
          {m.type === "text" ? (
            <textarea
              className="pb-media-edit__input"
              value={m.value}
              onChange={(e) => update(i, { value: e.target.value })}
              placeholder="안내 텍스트"
              rows={2}
            />
          ) : (
            <input
              className="pb-media-edit__input"
              value={m.value}
              onChange={(e) => update(i, { value: e.target.value })}
              placeholder={m.type === "image" ? "이미지 URL (또는 업로드)" : "유튜브 링크 붙여넣기"}
            />
          )}
          {m.type === "image" && m.value && (
            <img className="pb-media-edit__thumb" src={m.value} alt="" />
          )}
          {m.type !== "text" && (
            <input
              className="pb-media-edit__cap"
              value={m.caption || ""}
              onChange={(e) => update(i, { caption: e.target.value })}
              placeholder="설명(선택)"
            />
          )}
          <button className="pb-textbtn pb-del" onClick={() => remove(i)} title="삭제">
            ✕
          </button>
        </div>
      ))}
      <div className="pb-media-edit__btns">
        <label className="pb-textbtn pb-media-upl">
          {uploading ? "업로드 중…" : "📤 사진 업로드"}
          <input
            type="file"
            accept="image/*"
            multiple
            hidden
            disabled={uploading}
            onChange={(e) => onUpload(e.target.files)}
          />
        </label>
        <button className="pb-textbtn" onClick={() => add({ type: "image", value: "" })}>
          🖼 사진 URL
        </button>
        <button className="pb-textbtn" onClick={() => add({ type: "youtube", value: "" })}>
          ▶ 유튜브
        </button>
        <button className="pb-textbtn" onClick={() => add({ type: "text", value: "" })}>
          📝 텍스트
        </button>
      </div>
    </div>
  );
}
