import { bridgePrompt } from './workbuddy.js';
import { fileIssue, MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES } from './review-policy.js';
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const size = bytes => `${(bytes / 1000).toFixed(1)} KB`;
export function openReviewExport(project, { api, modal, download, toast, refresh }) {
  const run = project.runs.findLast(r => r.revision === project.revision && r.cycle === project.cycle && !r.stale);
  if (!run) return toast('请先录入当前实现结果');
  modal('准备审查副本', `<p class="hint">选择文件后核对清单，再生成包含源码、差异和验收条件的单个 Markdown 文件。此操作不会发送给外部 Agent。</p><div class="bundle-pickers"><label>选择源码文件<input id="bundle-files" type="file" multiple></label><label>或选择项目目录<input id="bundle-folder" type="file" webkitdirectory multiple></label></div><div id="bundle-selection"><p class="hint">尚未选择文件。数据、隐藏配置、依赖与构建目录会被排除。</p></div><p class="note">副本不授予原目录访问权，也不能撤销外部 Agent 已有的本机权限。它不扫描源码中的秘密，发送前需要核对内容。</p><label class="bundle-confirm"><input type="checkbox" id="bundle-version">我确认选中的文件对应代码版本 <code>${escape(run.version)}</code></label><div id="bundle-error" class="error" role="alert"></div><div class="actions"><button id="bundle-generate" class="primary" disabled>生成预览</button></div>`);
  const selection = document.querySelector('#bundle-selection');
  const error = document.querySelector('#bundle-error');
  const generate = document.querySelector('#bundle-generate');
  const confirmation = document.querySelector('#bundle-version');
  let candidates = [];
  const selectedFiles = () => [...selection.querySelectorAll('input[data-file-index]:checked')].map(el => candidates[Number(el.dataset.fileIndex)]);
  function update() {
    const chosen = selectedFiles();
    const total = chosen.reduce((sum, item) => sum + item.file.size, 0);
    const exceeded = chosen.length > MAX_FILES || total > MAX_TOTAL_BYTES;
    error.textContent = exceeded ? '最多 80 个文件，总计不超过 1 MB。请减少选择。' : '';
    generate.disabled = !chosen.length || !confirmation.checked || exceeded;
    const count = document.querySelector('#bundle-count');
    if (count) count.textContent = `${chosen.length} 个文件 · ${size(total)}`;
  }
  function choose(event) {
    const available = Array.from(event.target.files).map(file => {
      const path = file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(1).join('/') : file.name;
      return { file, path, issue: fileIssue(path) || (file.size > MAX_FILE_BYTES ? '超过单文件 300 KB 限制' : null) };
    });
    candidates = available.filter(item => !item.issue);
    const excluded = available.filter(item => item.issue);
    confirmation.checked = false;
    selection.innerHTML = `<div class="bundle-selection-head"><span id="bundle-count"></span><span>${excluded.length} 个已排除</span></div><div class="bundle-file-list">${candidates.map((item, index) => `<label><input type="checkbox" data-file-index="${index}" checked><span>${escape(item.path)}</span><small>${size(item.file.size)}</small></label>`).join('') || '<p class="hint">没有可选的文本源码。</p>'}</div>${excluded.length ? `<details class="bundle-excluded"><summary>查看排除原因</summary>${excluded.map(item => `<div><code>${escape(item.path)}</code><span>${escape(item.issue)}</span></div>`).join('')}</details>` : ''}`;
    update();
  }
  document.querySelector('#bundle-files').onchange = choose;
  document.querySelector('#bundle-folder').onchange = choose;
  selection.onchange = update;
  confirmation.onchange = update;
  generate.onclick = async () => {
    generate.disabled = true;
    try {
      const chosen = selectedFiles();
      const files = [];
      // Read only checked files. Rejected directory entries are never read.
      for (const item of chosen) {
        const bytes = await item.file.arrayBuffer();
        const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        files.push({ path: item.path, content });
      }
      const bundle = await api(`/${project.id}/review-bundle`, { method: 'POST', body: { files, confirmVersion: run.version } });
      modal('审查副本预览', `<div class="bundle-meta"><code>${escape(bundle.bundleId)}</code><span>${bundle.manifest.length} 个文件 · ${size(bundle.totalBytes)}</span></div><p class="hint">代码版本：${escape(bundle.reviewedVersion)} · 材料隔离，非权限沙箱</p><div class="bundle-manifest">${bundle.manifest.map(file => `<div><span>${escape(file.path)}</span><code title="${file.sha256}">${file.sha256.slice(0, 12)}</code></div>`).join('')}</div><details class="bundle-task-preview"><summary>本次任务内容</summary><pre class="pack-preview">${escape(JSON.stringify(bundle.task, null, 2))}</pre></details><pre class="pack-preview">${escape(bundle.text)}</pre><div class="actions"><button id="bundle-download" class="primary">下载审查副本</button></div><label class="bundle-confirm"><input type="checkbox" id="publish-consent">我授权 WorkBuddy 通过连接器读取以上副本；材料可能发送至其模型服务。发布后仅此副本会保存在本机派发队列。</label><div class="actions"><button id="publish-workbuddy" disabled>发布到 WorkBuddy 队列</button></div><div id="publish-error" class="error" role="alert"></div><p class="hint">下载不会自动改变任务状态。实际交给 Agent 后再确认发出。</p>`);
      document.querySelector('#bundle-download').onclick = () => download(`${bundle.bundleId}.md`, bundle.text);
      const publishButton=document.querySelector('#publish-workbuddy');
      document.querySelector('#publish-consent').onchange=e=>{publishButton.disabled=!e.target.checked;};
      publishButton.onclick=async()=>{
        publishButton.disabled=true;
        try {
          const job=await api(`/${project.id}/workbuddy`,{method:'POST',body:{files,confirmVersion:run.version,publishConsent:true}});
          await refresh();
          modal('已发布，等待 WorkBuddy 领取',`<p class="hint">副本已保存到本机队列。请将以下指令交给已配置连接器的 WorkBuddy；这一步不会自动唤起 Agent。</p><pre class="pack-preview">${escape(bridgePrompt(job))}</pre><div class="actions"><button id="copy-workbuddy-prompt" class="primary">复制领取指令</button></div>`);
          document.querySelector('#copy-workbuddy-prompt').onclick=async()=>{try{await navigator.clipboard.writeText(bridgePrompt(job));toast('已复制');}catch{toast('请手工复制以上指令');}};
        } catch(err){document.querySelector('#publish-error').textContent=err.message;publishButton.disabled=false;}
      };

    } catch (err) {
      error.textContent = err instanceof TypeError ? '读取失败：请确认选择的都是有效 UTF-8 文本，或减少文件数量。' : err.message;
      update();
      // update() only owns size errors; keep the actual failure visible.
      error.textContent = err.message;
    }
  };
}
