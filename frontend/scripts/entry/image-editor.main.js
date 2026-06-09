/**
 * NextGen Image Studio - 完整JS逻辑
 * 文生图 / 图生图 / 局部重绘 / 图片调整 / 历史记录
 */

(function () {
  // ========== DOM 工具 ==========
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  // ========== 状态 ==========
  let state = {
    generating: false,
    mode: 'txt2img',           // txt2img | img2img | inpaint
    model: 'jimeng',
    style: '',
    refImage: null,
    refImageName: '',
    strength: 'medium',
    brushSize: 'small',
    ratio: '16:9',
    count: 2,
    history: [],
    results: [],
    currentIndex: -1,
    maskData: null,
    modalImageUrl: null,
    maskCanvasReady: false,
  };

  // ========== 初始化 ==========
  function init() {
    initTabs();
    initModelChips();
    initModeTabs();
    initTradeWorkflow();
    initStylePresets();
    initPromptInput();
    initRefUpload();
    initStrengthBtns();
    initBrushSizes();
    initInpaintBtns();
    initGenControls();
    initGenBtn();
    initImageUpload();
    initEditPanel();
    initModal();
    initHistory();
    initColorPanel();
    loadHistory();
    updateEmptyStateText();
    updateCanvasStatus();
    loadTemplate();
  }

  function loadTemplate() {
    try {
      const t = JSON.parse(localStorage.getItem('nextgen_template'));
      if (!t) return;
      if (t.style) {
        const btn = document.querySelector('.preset-btn[data-style="' + t.style + '"]');
        if (btn) {
          $$('.preset-btn').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          state.style = t.style;
        }
      }
      if (t.mode) {
        const tab = document.querySelector('.mode-tab[data-mode="' + t.mode + '"]');
        if (tab) tab.click();
      }
      if (t.prompt) $('#promptInput').value = t.prompt;
      localStorage.removeItem('nextgen_template');
    } catch(e) {}
  }

  // ========== Tab 切换 ==========
  function initTabs() {
    $$('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.tab-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        $('#aiSection').style.display = tab === 'ai' ? '' : 'none';
        $('#editSection').style.display = tab === 'edit' ? '' : 'none';
        if (tab === 'edit') {
          const current = state.results[state.currentIndex] || state.results[0];
          if (current) {
            showPreview(current.url);
          }
        } else if (state.results.length) {
          renderResults(state.results);
        }
        updateEmptyStateText();
        updateCanvasStatus();
      });
    });
  }

  // ========== 模型选择（动态从配置加载）==========
  const IMAGE_PROVIDER_MAP = {
    jimeng:'即梦', flux:'Flux', dalle:'DALL·E', imagen:'Imagen', sd:'SD',
    ideogram:'Ideogram', seedream:'Seedream', wanx:'万相', midjourney:'MJ',
    recraft:'Recraft', pixverse:'Pixverse', 'kling-image':'可灵'
  };

  const IMAGE_PROVIDER_ENDPOINTS = {
    dalle: 'https://api.openai.com/v1',
    openai: 'https://api.openai.com/v1',
    flux: 'https://api.bfl.ml/v1',
    ideogram: 'https://api.ideogram.ai/v1',
    recraft: 'https://api.recraft.ai/v1',
    sd: 'https://api.stability.ai/v1',
  };

  function parseProviderModel(value, fallbackProvider, fallbackModel) {
    const parts = String(value || '').split(':');
    const provider = parts.shift() || fallbackProvider;
    return {
      provider,
      model: parts.join(':') || fallbackModel || '',
    };
  }

  function getSavedApiConfig() {
    try {
      return JSON.parse(localStorage.getItem('nextgen_api_config') || '{}') || {};
    } catch (e) {
      return {};
    }
  }

  function getCustomImageProvider(cfg, providerId) {
    return (cfg.custom || []).find((c) =>
      c && c.type === 'image' && String(c.name || '').trim() === providerId
    ) || null;
  }

  function getImageProviderConfig(cfg, providerId) {
    const direct = (cfg.image || {})[providerId];
    if (direct) {
      return {
        ...direct,
        endpoint: direct.endpoint || direct.api_base || IMAGE_PROVIDER_ENDPOINTS[providerId] || '',
        api_base: direct.api_base || direct.endpoint || IMAGE_PROVIDER_ENDPOINTS[providerId] || '',
      };
    }
    const custom = getCustomImageProvider(cfg, providerId);
    if (!custom) return null;
    return {
      key: custom.key || '',
      model: custom.model || '',
      endpoint: custom.endpoint || '',
      api_base: custom.endpoint || '',
      custom: true,
    };
  }

  function getGenerationSourceImage() {
    if (state.mode === 'img2img') return state.refImage || '';
    if (state.mode === 'inpaint') {
      const current = state.results[state.currentIndex] || state.results[0];
      return current && current.url ? current.url : '';
    }
    return '';
  }

  async function generateWithConfiguredApi({ provider, model, endpoint, key, prompt }) {
    const body = {
      endpoint,
      api_key: key,
      model,
      prompt,
      mode: state.mode,
      count: state.count,
      ratio: state.ratio,
    };
    const sourceImage = getGenerationSourceImage();
    if (state.mode !== 'txt2img') body.image = sourceImage;
    if (state.mode === 'inpaint' && state.maskData) body.mask = state.maskData;

    const resp = await fetch('/api/image/openai-compatible/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.ok) {
      const detail = data.recovery_suggestion ? '：' + data.recovery_suggestion : '';
      throw new Error((data.error || data.error_code || ('HTTP ' + resp.status)) + detail);
    }
    const images = Array.isArray(data.images) ? data.images : [];
    if (!images.length) throw new Error('接口没有返回图片结果');
    return images.map((img, index) => ({ url: img.url || img.data_url, index, provider, model }));
  }

  function loadModelChips() {
    const container = $('#modelChips');
    if (!container) return;
    container.innerHTML = '';

    // Read configured providers from settings
    let configuredProviders = [];
    let defaultProvider = 'jimeng';
    let defaultModelName = 'jimeng-5.0';
    let cfg = {};
    try {
      cfg = getSavedApiConfig();
      const parsedDefault = parseProviderModel(cfg.defaults && cfg.defaults.image, 'jimeng', 'jimeng-5.0');
      defaultProvider = parsedDefault.provider;
      defaultModelName = parsedDefault.model;
      const imageKeys = cfg.image || {};
      Object.keys(imageKeys).forEach(pid => {
        if (imageKeys[pid] && imageKeys[pid].key) configuredProviders.push(pid);
      });
      (cfg.custom || []).forEach(c => {
        const name = String(c?.name || '').trim();
        if (c?.type === 'image' && name && c.key && !configuredProviders.includes(name)) configuredProviders.push(name);
      });
    } catch(e) {}

    // Always include default if not already present
    if (!configuredProviders.includes(defaultProvider)) configuredProviders.unshift(defaultProvider);
    // Always include jimeng as fallback
    if (!configuredProviders.includes('jimeng')) configuredProviders.unshift('jimeng');

    // Render chips
    configuredProviders.slice(0, 6).forEach(pid => {
      const name = IMAGE_PROVIDER_MAP[pid] || pid;
      const providerCfg = getImageProviderConfig(cfg, pid);
      const providerModel = (providerCfg && providerCfg.model)
        ? providerCfg.model
        : (pid === defaultProvider ? defaultModelName : '');
      const btn = document.createElement('button');
      btn.className = 'model-chip';
      btn.dataset.model = pid;
      btn.dataset.modelName = providerModel;
      btn.innerHTML = '<span class="chip-main">' + name + '</span>' + (providerModel ? '<span class="chip-sub">' + providerModel + '</span>' : '');
      if (pid === defaultProvider) btn.classList.add('active');
      btn.addEventListener('click', () => {
        $$('.model-chip').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.model = btn.dataset.model;
        updateModelStatus();
        updateCanvasStatus();
      });
      container.appendChild(btn);
    });

    // Set initial state
    const activeChip = container.querySelector('.model-chip.active');
    state.model = activeChip ? activeChip.dataset.model : (configuredProviders[0] || 'jimeng');
    updateModelStatus();
  }

  function initModelChips() {
    loadModelChips();
  }

  // ========== 模式切换 ==========
  function initModeTabs() {
    $$('.mode-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.mode-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.mode = btn.dataset.mode;
        updateModeUI();
        updateCanvasStatus();
      });
    });
  }

  function updateModeUI() {
    const refSection = $('#refSection');
    const inpaintSection = $('#inpaintSection');
    const stylePresets = $('#stylePresets');
    const countField = $('#countField');
    const maskCanvas = $('#maskCanvas');

    if (state.mode === 'txt2img') {
      refSection.style.display = 'none';
      inpaintSection.style.display = 'none';
      stylePresets.style.display = '';
      countField.style.display = '';
    } else if (state.mode === 'img2img') {
      refSection.style.display = '';
      inpaintSection.style.display = 'none';
      stylePresets.style.display = 'none';
      countField.style.display = '';
    } else if (state.mode === 'inpaint') {
      refSection.style.display = 'none';
      inpaintSection.style.display = '';
      stylePresets.style.display = 'none';
      countField.style.display = '';
      maskCanvas.style.display = '';
      initMaskCanvas();
    }

    if (state.mode !== 'inpaint') {
      $('#maskCanvas').style.display = 'none';
      state.maskCanvasReady = false;
    }

    updateEmptyStateText();
    updateCanvasStatus();
  }

  const TRADE_WORKFLOWS = {
    cutout: {
      mode: 'inpaint',
      title: 'AI 高清扣图 + 批量整理 + Excel 导出',
      desc: '适合外贸报价、工厂推广和电商运营。先把随手拍产品图处理成干净主图，再整理成可导出的资料。',
      prompt: '把上传的产品照片处理成专业电商主图：主体高清保留，去除杂乱背景，白色或透明干净背景，边缘清晰，阴影自然，适合报价单和产品资料导出。',
    },
    variants: {
      mode: 'img2img',
      title: '外贸产品裂变：1 个爆款延伸多款新品',
      desc: '适合新品开发、客户提案和电商上新。基于一个爆款，按元素、图案、配色方向快速扩展多款方案。',
      prompt: '基于参考产品做外贸新品系列裂变：保留原产品结构和卖点，延伸 20 款不同图案、配色和主题方向，输出成一组可提案的新款产品方案，风格统一且有差异。',
    },
    apply: {
      mode: 'img2img',
      title: '图案快速应用 + 指定 Pantone 色号预览',
      desc: '适合客户确认设计方向。把图案、想法或色号快速应用到产品上，几分钟看到接近打样的效果。',
      prompt: '将指定图案和 Pantone 色号应用到参考产品上，保持产品形状、材质和真实光影，生成可展示的产品效果图。颜色准确，图案贴合产品表面，不变形。',
    },
  };

  function initTradeWorkflow() {
    const root = $('#tradeWorkflow');
    if (!root) return;
    const titleNode = $('#workflowTitle');
    const descNode = $('#workflowDesc');

    function activate(key, applyPrompt = false) {
      const cfg = TRADE_WORKFLOWS[key] || TRADE_WORKFLOWS.cutout;
      $$('.workflow-tab').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.workflow === key);
      });
      if (titleNode) titleNode.textContent = cfg.title;
      if (descNode) descNode.textContent = cfg.desc;
      try { localStorage.setItem(WORKFLOW_LS_KEY, key); } catch (_e) {}
      try { updateColorPanelVisibility(); } catch (_e) {}
      if (!applyPrompt) return;

      const modeTab = document.querySelector('.mode-tab[data-mode="' + cfg.mode + '"]');
      if (modeTab) modeTab.click();
      const promptInput = $('#promptInput');
      if (promptInput) {
        promptInput.value = cfg.prompt;
        promptInput.focus();
        try { localStorage.setItem(PROMPT_LS_KEY, cfg.prompt); } catch (_e) {}
      }
    }

    $$('.workflow-tab').forEach((btn) => {
      btn.addEventListener('click', () => activate(btn.dataset.workflow, true));
    });

    root.querySelector('[data-action="use-template"]')?.addEventListener('click', () => {
      const active = root.querySelector('.workflow-tab.active');
      activate(active?.dataset.workflow || 'cutout', true);
    });

    root.querySelector('[data-action="need-ref"]')?.addEventListener('click', () => {
      const active = root.querySelector('.workflow-tab.active');
      const key = active?.dataset.workflow || 'cutout';
      const mode = key === 'cutout' ? 'inpaint' : 'img2img';
      const modeTab = document.querySelector('.mode-tab[data-mode="' + mode + '"]');
      if (modeTab) modeTab.click();
      if (mode === 'img2img') $('#refInput')?.click();
      if (mode === 'inpaint') $('#imageInput')?.click();
    });

    // Restore last selected workflow tab (without re-applying its prompt).
    try {
      const lastKey = localStorage.getItem(WORKFLOW_LS_KEY);
      if (lastKey && TRADE_WORKFLOWS[lastKey]) {
        activate(lastKey, false);
      }
    } catch (_e) {}
  }

  // ========== 色号应用面板 ==========
  // 30 个常用色号（色卡 / 服装外贸常用色）
  const COLOR_SWATCHES = [
    { name: '正黑', hex: '#000000' },
    { name: '本白', hex: '#F8F4E9' },
    { name: '米白', hex: '#EFE6D5' },
    { name: '卡其', hex: '#C3A784' },
    { name: '驼色', hex: '#A47E5B' },
    { name: '咖啡', hex: '#6F4E37' },
    { name: '焦糖', hex: '#9C5A2C' },
    { name: '砖红', hex: '#C04A2F' },
    { name: '酒红', hex: '#7A1F2B' },
    { name: '樱粉', hex: '#F2B5C1' },
    { name: '胭脂', hex: '#D8576A' },
    { name: '珊瑚', hex: '#FF7F66' },
    { name: '橘黄', hex: '#F2A03D' },
    { name: '柠檬黄', hex: '#FFE16B' },
    { name: '草绿', hex: '#7CB342' },
    { name: '橄榄', hex: '#708238' },
    { name: '墨绿', hex: '#1E5631' },
    { name: '薄荷', hex: '#A8E6CF' },
    { name: '天蓝', hex: '#6FB7E8' },
    { name: '宝蓝', hex: '#1F4E79' },
    { name: '藏青', hex: '#1A2A47' },
    { name: '牛仔', hex: '#3D5A80' },
    { name: '雾紫', hex: '#B8A9D4' },
    { name: '葡萄', hex: '#5C2A4C' },
    { name: '银灰', hex: '#B8B8B8' },
    { name: '炭灰', hex: '#4A4A4A' },
    { name: '奶咖', hex: '#D9C5A8' },
    { name: '豆沙', hex: '#B58A8A' },
    { name: '抹茶', hex: '#B8C9A0' },
    { name: '雾蓝', hex: '#A8C0D6' },
  ];
  const SAVED_COLORS_LS_KEY = 'nextgen.imageEditor.savedColors';
  const ACTIVE_COLOR_LS_KEY = 'nextgen.imageEditor.activeColor';

  let colorPanelState = {
    active: { name: '', hex: '#ffffff' },
    saved: [],
    eyedropperActive: false,
  };

  function loadColorPanelState() {
    try {
      const a = localStorage.getItem(ACTIVE_COLOR_LS_KEY);
      if (a) {
        const parsed = JSON.parse(a);
        if (parsed && typeof parsed.hex === 'string') colorPanelState.active = parsed;
      }
      const s = localStorage.getItem(SAVED_COLORS_LS_KEY);
      if (s) {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) colorPanelState.saved = parsed.slice(0, 20);
      }
    } catch (_e) {}
  }

  function saveColorPanelState() {
    try {
      localStorage.setItem(ACTIVE_COLOR_LS_KEY, JSON.stringify(colorPanelState.active));
      localStorage.setItem(SAVED_COLORS_LS_KEY, JSON.stringify(colorPanelState.saved));
    } catch (_e) {}
  }

  function renderColorPalette() {
    const palette = $('#colorPalette');
    if (!palette) return;
    palette.innerHTML = '';
    COLOR_SWATCHES.forEach((c) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'color-swatch';
      btn.style.background = c.hex;
      btn.dataset.hex = c.hex;
      btn.dataset.name = c.name;
      btn.title = `${c.name} ${c.hex}`;
      const lbl = document.createElement('span');
      lbl.className = 'color-swatch-name';
      lbl.textContent = `${c.name} ${c.hex}`;
      btn.appendChild(lbl);
      if (colorPanelState.active.hex?.toLowerCase() === c.hex.toLowerCase()) {
        btn.classList.add('is-selected');
      }
      btn.addEventListener('click', () => {
        colorPanelState.active = { name: c.name, hex: c.hex };
        renderColorActive();
        renderColorPalette();
        saveColorPanelState();
      });
      palette.appendChild(btn);
    });
  }

  function renderColorActive() {
    const swatch = $('#colorActiveSwatch');
    const hex = $('#colorActiveHex');
    const name = $('#colorActiveName');
    if (swatch) swatch.style.background = colorPanelState.active.hex || '#ffffff';
    if (hex) hex.value = colorPanelState.active.hex || '';
    if (name) name.value = colorPanelState.active.name || '';
  }

  function renderSavedColors() {
    const row = $('#colorSavedRow');
    const list = $('#colorSavedList');
    if (!row || !list) return;
    if (!colorPanelState.saved.length) {
      row.hidden = true;
      list.innerHTML = '';
      return;
    }
    row.hidden = false;
    list.innerHTML = '';
    colorPanelState.saved.forEach((c, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'color-saved-swatch';
      btn.style.background = c.hex;
      btn.title = `${c.name || ''} ${c.hex}`;
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'color-saved-remove';
      rm.textContent = '×';
      rm.addEventListener('click', (ev) => {
        ev.stopPropagation();
        colorPanelState.saved.splice(idx, 1);
        saveColorPanelState();
        renderSavedColors();
      });
      btn.appendChild(rm);
      btn.addEventListener('click', () => {
        colorPanelState.active = { name: c.name, hex: c.hex };
        renderColorActive();
        renderColorPalette();
        saveColorPanelState();
      });
      list.appendChild(btn);
    });
  }

  function updateColorPanelVisibility() {
    const panel = $('#colorPanel');
    if (!panel) return;
    const activeTab = document.querySelector('.workflow-tab.active');
    const isApply = activeTab && activeTab.dataset.workflow === 'apply';
    panel.hidden = !isApply;
  }

  function appendColorToPrompt() {
    const promptInput = $('#promptInput');
    if (!promptInput) return;
    const c = colorPanelState.active;
    if (!c || !c.hex) return;
    const tag = `${c.name || '色号'} ${c.hex.toUpperCase()}`;
    // Don't append the same color twice in a row.
    const cur = promptInput.value.trim();
    if (cur && cur.toLowerCase().endsWith(c.hex.toLowerCase())) return;
    promptInput.value = (cur ? cur + '，' : '') + tag;
    try { localStorage.setItem(PROMPT_LS_KEY, promptInput.value); } catch (_e) {}
    promptInput.focus();
  }

  function saveActiveColor() {
    const c = colorPanelState.active;
    if (!c || !c.hex) return;
    const exists = colorPanelState.saved.some(
      (s) => (s.hex || '').toLowerCase() === c.hex.toLowerCase()
    );
    if (exists) return;
    colorPanelState.saved.unshift({ name: c.name || '', hex: c.hex });
    if (colorPanelState.saved.length > 20) colorPanelState.saved.length = 20;
    saveColorPanelState();
    renderSavedColors();
  }

  /**
   * Eyedropper: any-time color picker.
   * Strategy:
   *  1) Open a modal with three options:
   *     a) Upload any image just for sampling (works without ref image)
   *     b) Use the existing ref image (if any)
   *     c) System EyeDropper API (if available, picks from anywhere on screen)
   *  2) On image pick → render it in a clickable stage; click to sample.
   *  3) On confirm → set colorPanelState.active and close the modal.
   */
  let pickerModalState = {
    imageDataUrl: null,
    pendingHex: null,
    pendingCoord: null,
  };

  function openColorPickModal() {
    const modal = $('#colorPickModal');
    if (!modal) return;
    pickerModalState = { imageDataUrl: null, pendingHex: null, pendingCoord: null };
    // Show "从已上传参考图取色" only when ref image exists.
    const fromRefBtn = $('#colorPickFromRefBtn');
    if (fromRefBtn) fromRefBtn.hidden = !state.refImage;
    // Disable system picker if EyeDropper API is unavailable.
    const sysBtn = $('#colorPickNativeBtn');
    if (sysBtn) {
      const supported = typeof window !== 'undefined' && 'EyeDropper' in window;
      sysBtn.disabled = !supported;
      sysBtn.title = supported ? '从屏幕任意位置取色' : '当前浏览器不支持系统取色器（仅 Chromium 内核支持）';
      sysBtn.style.opacity = supported ? '1' : '0.45';
      sysBtn.style.cursor = supported ? 'pointer' : 'not-allowed';
    }
    // Reset stage.
    const stage = $('#colorPickStage');
    if (stage) stage.innerHTML = '<div class="color-pick-hint">选择上方任一方式开始取色</div>';
    const zoom = $('#colorPickZoom');
    if (zoom) zoom.hidden = true;
    modal.hidden = false;
  }

  function closeColorPickModal() {
    const modal = $('#colorPickModal');
    if (modal) modal.hidden = true;
    pickerModalState = { imageDataUrl: null, pendingHex: null, pendingCoord: null };
  }

  function loadImageIntoStage(dataUrl) {
    pickerModalState.imageDataUrl = dataUrl;
    pickerModalState.pendingHex = null;
    pickerModalState.pendingCoord = null;
    const stage = $('#colorPickStage');
    if (!stage) return;
    stage.innerHTML = '';
    const img = document.createElement('img');
    img.className = 'color-pick-image';
    img.alt = '点击取色';
    img.src = dataUrl;
    img.addEventListener('click', onStageClick);
    stage.appendChild(img);
    // Reset zoom info.
    const zoom = $('#colorPickZoom');
    if (zoom) zoom.hidden = true;
    const coord = $('#colorPickZoomCoord');
    if (coord) coord.textContent = '--';
    const hex = $('#colorPickZoomHex');
    if (hex) hex.textContent = '#--';
    const confirm = $('#colorPickConfirmBtn');
    if (confirm) confirm.disabled = true;
  }

  function onStageClick(e) {
    const img = e.currentTarget;
    if (!img.complete || !img.naturalWidth) return;
    // Draw into a hidden canvas (downscaled) and read the pixel under the cursor.
    const c = document.createElement('canvas');
    const maxDim = 800;
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    c.width = Math.max(1, Math.floor(img.naturalWidth * scale));
    c.height = Math.max(1, Math.floor(img.naturalHeight * scale));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    try {
      ctx.drawImage(img, 0, 0, c.width, c.height);
    } catch (err) {
      console.error('drawImage failed', err);
      return;
    }
    const r = img.getBoundingClientRect();
    const px = Math.max(0, Math.min(c.width - 1, Math.floor((e.clientX - r.left) * (c.width / r.width))));
    const py = Math.max(0, Math.min(c.height - 1, Math.floor((e.clientY - r.top) * (c.height / r.height))));
    let data;
    try {
      data = ctx.getImageData(px, py, 1, 1).data;
    } catch (err) {
      // Tainted canvas: usually because the image was loaded from another origin
      // and the server didn't send CORS headers. Fall back to file re-read.
      console.warn('canvas tainted, falling back', err);
      if (pickerModalState.imageDataUrl) {
        sampleFromDataUrl(pickerModalState.imageDataUrl, e.clientX, e.clientY, r);
      }
      return;
    }
    const hex = '#' + [data[0], data[1], data[2]]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
    pickerModalState.pendingHex = hex;
    pickerModalState.pendingCoord = { x: e.clientX - Math.round(r.left), y: e.clientY - Math.round(r.top) };
    showPendingColor(hex, pickerModalState.pendingCoord);
  }

  // Robust fallback: load data URL into a fresh Image + canvas (CORS-clean).
  function sampleFromDataUrl(dataUrl, clientX, clientY, rect) {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      const maxDim = 800;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      c.width = Math.max(1, Math.floor(img.width * scale));
      c.height = Math.max(1, Math.floor(img.height * scale));
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const px = Math.max(0, Math.min(c.width - 1, Math.floor((clientX - rect.left) * (c.width / rect.width))));
      const py = Math.max(0, Math.min(c.height - 1, Math.floor((clientY - rect.top) * (c.height / rect.height))));
      const data = ctx.getImageData(px, py, 1, 1).data;
      const hex = '#' + [data[0], data[1], data[2]]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
      pickerModalState.pendingHex = hex;
      pickerModalState.pendingCoord = { x: clientX - Math.round(rect.left), y: clientY - Math.round(rect.top) };
      showPendingColor(hex, pickerModalState.pendingCoord);
    };
    img.onerror = () => console.error('failed to load image for sampling');
    img.src = dataUrl;
  }

  function showPendingColor(hex, coord) {
    const zoom = $('#colorPickZoom');
    if (zoom) zoom.hidden = false;
    const coordEl = $('#colorPickZoomCoord');
    if (coordEl && coord) coordEl.textContent = `坐标 ${coord.x}, ${coord.y}`;
    const hexEl = $('#colorPickZoomHex');
    if (hexEl) {
      hexEl.textContent = hex;
      hexEl.style.color = hex;
    }
    const confirm = $('#colorPickConfirmBtn');
    if (confirm) confirm.disabled = false;
  }

  function confirmPickedColor() {
    const hex = pickerModalState.pendingHex;
    if (!hex) return;
    colorPanelState.active = { name: '取色', hex };
    renderColorActive();
    renderColorPalette();
    saveColorPanelState();
    closeColorPickModal();
  }

  async function startNativeEyeDropper() {
    if (typeof window === 'undefined' || !('EyeDropper' in window)) return;
    try {
      const dropper = new window.EyeDropper();
      const result = await dropper.open();
      const hex = (result?.sRGBHex || '').toUpperCase();
      if (hex) {
        colorPanelState.active = { name: '屏幕取色', hex };
        renderColorActive();
        renderColorPalette();
        saveColorPanelState();
        closeColorPickModal();
      }
    } catch (err) {
      // User cancelled — keep modal open.
      console.debug('EyeDropper cancelled', err);
    }
  }

  function handleColorPickFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => loadImageIntoStage(ev.target.result);
    reader.onerror = () => console.error('failed to read file');
    reader.readAsDataURL(file);
  }

  // Backward-compat alias: legacy code may still call startEyedropper() to open the modal.
  function startEyedropper() {
    openColorPickModal();
  }

  function initColorPanel() {
    const panel = $('#colorPanel');
    if (!panel) return;
    loadColorPanelState();
    renderColorPalette();
    renderColorActive();
    renderSavedColors();
    updateColorPanelVisibility();

    // Hex input — live update swatch
    const hexInput = $('#colorActiveHex');
    hexInput?.addEventListener('input', () => {
      let v = hexInput.value.trim();
      if (!v.startsWith('#')) v = '#' + v;
      if (/^#([0-9a-fA-F]{6})$/.test(v)) {
        colorPanelState.active.hex = v;
        renderColorActive();
        renderColorPalette();
        saveColorPanelState();
      }
    });
    // Name input
    const nameInput = $('#colorActiveName');
    nameInput?.addEventListener('input', () => {
      colorPanelState.active.name = nameInput.value;
      saveColorPanelState();
    });
    // Apply to prompt
    $('#colorApplyBtn')?.addEventListener('click', appendColorToPrompt);
    // Save current color (double-click on apply to save into the saved list)
    $('#colorApplyBtn')?.addEventListener('dblclick', saveActiveColor);
    // Eyedropper — opens the multi-source color picker modal
    $('#colorEyedropperBtn')?.addEventListener('click', startEyedropper);
    // Clear saved
    $('#colorClearBtn')?.addEventListener('click', () => {
      colorPanelState.saved = [];
      saveColorPanelState();
      renderSavedColors();
    });

    // Color picker modal wiring
    $('#colorPickCloseBtn')?.addEventListener('click', closeColorPickModal);
    $('#colorPickModal')?.addEventListener('click', (e) => {
      // Click on the backdrop closes the modal.
      if (e.target === e.currentTarget) closeColorPickModal();
    });
    $('#colorPickUploadBtn')?.addEventListener('click', () => $('#colorPickFileInput')?.click());
    $('#colorPickFileInput')?.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) handleColorPickFile(f);
      e.target.value = '';
    });
    $('#colorPickFromRefBtn')?.addEventListener('click', () => {
      if (state.refImage) loadImageIntoStage(state.refImage);
    });
    $('#colorPickNativeBtn')?.addEventListener('click', () => {
      if (!$('#colorPickNativeBtn').disabled) startNativeEyeDropper();
    });
    $('#colorPickCancelBtn')?.addEventListener('click', closeColorPickModal);
    $('#colorPickConfirmBtn')?.addEventListener('click', confirmPickedColor);

    // Esc closes modal.
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !$('#colorPickModal')?.hidden) closeColorPickModal();
    });

    // Watch workflow tab changes to show/hide the panel.
    document.querySelectorAll('.workflow-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        // run after activate() to read new active class
        setTimeout(updateColorPanelVisibility, 0);
      });
    });
  }

  function updateEmptyStateText() {
    const emptyTitle = $('#emptyTitle');
    const emptyHintText = $('#emptyHintText');
    const emptyIcon = $('#emptyIcon');
    const hintArrow = $('#hintArrow');
    if (!emptyTitle || !emptyHintText) return;

    const activeTab = document.querySelector('.tab-btn.active');
    if (activeTab && activeTab.dataset.tab === 'edit') {
      emptyTitle.textContent = '上传图片开始编辑';
      emptyHintText.textContent = '支持 JPG、PNG、WebP 格式';
      if (hintArrow) hintArrow.style.display = 'none';
      if (emptyIcon) emptyIcon.innerHTML = '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none"/><path d="M21 15l-5-5L5 21"/>';
      return;
    }

    if (hintArrow) hintArrow.style.display = state.mode === 'txt2img' ? '' : 'none';

    if (state.mode === 'txt2img') {
      emptyTitle.textContent = '生成的图片将在这里显示';
      emptyHintText.textContent = '输入描述后点击生成';
      if (emptyIcon) emptyIcon.innerHTML = '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>';
    } else if (state.mode === 'img2img') {
      emptyTitle.textContent = '点击或拖拽上传图片';
      emptyHintText.textContent = '或直接输入描述生成 AI 图片';
      if (emptyIcon) emptyIcon.innerHTML = '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none"/><path d="M21 15l-5-5L5 21"/>';
    } else if (state.mode === 'inpaint') {
      emptyTitle.textContent = '上传图片后涂抹区域';
      emptyHintText.textContent = '用画笔涂抹要修改的位置';
      if (emptyIcon) emptyIcon.innerHTML = '<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/>';
    }
  }

  // ========== 风格预设 ==========
  function initStylePresets() {
    $$('.preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.preset-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.style = btn.dataset.style;
        const styleToPrompt = {
          clean: '白色纯净背景，电商主图，专业摄影光影',
          model: '模特穿戴效果图，精致妆容，室内影棚',
          scene: '生活场景植入，家居环境，自然光线',
          transparent: '透明背景PNG，纯白底，产品摄影级',
        };
        if (styleToPrompt[state.style]) {
          const promptInput = $('#promptInput');
          promptInput.value = styleToPrompt[state.style];
        }
      });
    });
  }

  // ========== 提示词 ==========
  function initPromptInput() {
    const promptInput = $('#promptInput');
    // Restore last prompt so page navigation/refresh doesn't wipe the user's text.
    try {
      const saved = localStorage.getItem(PROMPT_LS_KEY);
      if (saved !== null && promptInput) promptInput.value = saved;
    } catch (_e) {}
    if (promptInput) {
      promptInput.addEventListener('input', () => {
        try { localStorage.setItem(PROMPT_LS_KEY, promptInput.value); } catch (_e) {}
      });
    }
    $('#randomBtn').addEventListener('click', () => {
      const prompts = [
        '精致礼盒包装，特写镜头，柔光箱照明，4K高清',
        '女士手提包，模特场景，街拍风格，自然日光',
        '运动跑鞋，产品特写，深色背景，专业运动摄影',
        '护肤精华液，透明瓶身，实验室风格，简洁背景',
        '茶叶包装，中国风，竹背景，传统工艺',
      ];
      const v = prompts[Math.floor(Math.random() * prompts.length)];
      promptInput.value = v;
      try { localStorage.setItem(PROMPT_LS_KEY, v); } catch (_e) {}
    });
    $('#clearPromptBtn').addEventListener('click', () => {
      promptInput.value = '';
      promptInput.focus();
      try { localStorage.removeItem(PROMPT_LS_KEY); } catch (_e) {}
    });
  }

  // ========== 参考图上传 ==========
  const REF_IMAGE_LS_KEY = 'nextgen.imageEditor.refImage';
  const REF_IMAGE_NAME_LS_KEY = 'nextgen.imageEditor.refImageName';
  const PROMPT_LS_KEY = 'nextgen.imageEditor.prompt';
  const WORKFLOW_LS_KEY = 'nextgen.imageEditor.workflow';

  function persistRefImage() {
    try {
      if (state.refImage) {
        localStorage.setItem(REF_IMAGE_LS_KEY, state.refImage);
        if (state.refImageName) localStorage.setItem(REF_IMAGE_NAME_LS_KEY, state.refImageName);
      } else {
        localStorage.removeItem(REF_IMAGE_LS_KEY);
        localStorage.removeItem(REF_IMAGE_NAME_LS_KEY);
      }
    } catch (e) { /* ignore quota errors */ }
  }

  function restoreRefImage() {
    try {
      const dataUrl = localStorage.getItem(REF_IMAGE_LS_KEY);
      if (!dataUrl) return;
      const name = localStorage.getItem(REF_IMAGE_NAME_LS_KEY) || '';
      state.refImage = dataUrl;
      state.refImageName = name;
      const preview = $('#refPreview');
      const refName = $('#refName');
      const refInfo = $('#refInfo');
      const boxEl = $('#refUploadBox');
      const styleStrength = $('#styleStrength');
      if (preview) preview.src = dataUrl;
      if (refName) refName.textContent = name;
      if (refInfo) refInfo.style.display = '';
      if (boxEl) boxEl.style.display = 'none';
      if (styleStrength) styleStrength.style.display = '';
    } catch (e) { /* ignore */ }
  }

  function initRefUpload() {
    const box = $('#refUploadBox');
    const input = $('#refInput');
    box.addEventListener('click', () => input.click());
    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        state.refImage = ev.target.result;
        state.refImageName = file.name;
        $('#refPreview').src = ev.target.result;
        $('#refName').textContent = file.name;
        $('#refInfo').style.display = '';
        box.style.display = 'none';
        $('#styleStrength').style.display = '';
        persistRefImage();
      };
      reader.readAsDataURL(file);
    });
    $('#clearRefBtn').addEventListener('click', () => {
      state.refImage = null;
      state.refImageName = '';
      input.value = '';
      $('#refInfo').style.display = 'none';
      box.style.display = '';
      $('#styleStrength').style.display = 'none';
      persistRefImage();
    });
    // Restore last uploaded ref image so page navigation / refresh doesn't lose it.
    restoreRefImage();
  }

  // ========== 风格强度 ==========
  function initStrengthBtns() {
    $$('.strength-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.strength-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.strength = btn.dataset.strength;
      });
    });
  }

  // ========== 画笔工具 ==========
  function initBrushSizes() {
    const sizes = { small: 20, medium: 40, large: 80 };
    $$('.brush-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.brush-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.brushSize = btn.dataset.size;
        const hint = $('#brushHint');
        if (hint) hint.textContent = '画笔大小：' + sizes[state.brushSize] + 'px';
      });
    });
  }

  function initInpaintBtns() {
    $$('.inpaint-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        const actionToPrompt = {
          'remove-bg': '去掉背景，保留主体，透明背景',
          'change-bg': '换成白色纯净背景',
          'remove-watermark': '去除水印和文字',
          'change-color': '调整颜色为更鲜艳的色彩',
        };
        if (actionToPrompt[action]) {
          $('#promptInput').value = actionToPrompt[action];
        }
        $$('.mode-tab').forEach((b) => b.classList.remove('active'));
        $$('.mode-tab[data-mode="inpaint"]')[0].classList.add('active');
        state.mode = 'inpaint';
        updateModeUI();
      });
    });
  }

  // ========== 生成控制 ==========
  function initGenControls() {
    // 比例
    $$('.ratio-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.ratio-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.ratio = btn.dataset.ratio;
        updateCanvasStatus();
      });
    });

    // 数量
    $$('.count-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.count-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.count = parseInt(btn.dataset.count);
        updateGenHint();
        updateCanvasStatus();
      });
    });

    updateGenHint();
    updateCanvasStatus();
  }

  function updateGenHint() {
    const hint = $('#genHint');
    if (hint) hint.textContent = state.count + ' 张图';
  }

  function updateCanvasStatus() {
    const node = $('#canvasStatus');
    if (!node) return;
    const activeTab = document.querySelector('.tab-btn.active');
    if (activeTab && activeTab.dataset.tab === 'edit') {
      node.textContent = '图片调整 · 预设校色 · 本地预览';
      return;
    }
    const modeLabel = {
      txt2img: '文生图',
      img2img: '图生图',
      inpaint: '局部重绘',
    }[state.mode] || '文生图';
    const modelLabel = IMAGE_PROVIDER_MAP[state.model] || state.model || '即梦';
    const countLabel = state.mode === 'inpaint' ? '蒙版重绘' : state.count + '张';
    node.textContent = `${modeLabel} · ${modelLabel} · ${state.ratio} · ${countLabel}`;
  }

  function updateModelStatus() {
    const node = $('#modelStatus');
    if (!node) return;
    const modelLabel = IMAGE_PROVIDER_MAP[state.model] || state.model || '即梦';
    let hasKey = false;
    let modelName = '';
    let provider = null;
    try {
      const cfg = getSavedApiConfig();
      provider = getImageProviderConfig(cfg, state.model);
      hasKey = !!(provider && provider.key);
      const defaultImage = parseProviderModel(cfg.defaults && cfg.defaults.image, 'jimeng', 'jimeng-5.0');
      modelName = provider && provider.model ? provider.model : (defaultImage.provider === state.model ? defaultImage.model : '');
    } catch (e) { /* ignore */ }
    node.classList.toggle('ready', hasKey);
    node.classList.toggle('missing', !hasKey);
    node.querySelector('span').textContent = hasKey
      ? `当前模型：${modelLabel} · ${modelName || '默认模型'}`
      : `当前模型：${modelLabel} · 未配置 Key`;
    const link = node.querySelector('a');
    if (link) link.href = provider && provider.custom ? '/pages/settings.html#custom-api' : `/pages/settings.html#image-models-${state.model}`;
  }

  // ========== 生成按钮 ==========
  function initGenBtn() {
    $('#genBtn').addEventListener('click', handleGenerate);
  }

  async function handleGenerate() {
    if (state.generating) return;
    const prompt = $('#promptInput').value.trim();
    if (!prompt && state.mode !== 'inpaint') {
      alert('请输入图片描述');
      return;
    }
    if (state.mode === 'img2img' && !state.refImage) {
      alert('请先上传参考图');
      return;
    }
    if (state.mode === 'inpaint' && !state.results.length) {
      alert('请先上传需要局部重绘的图片');
      return;
    }

    // Read API config from settings, resolve provider + model from active chip
    let activeProvider = state.model || 'jimeng';
    let activeModel = 'jimeng-5.0';
    let providerConfig = null;
    try {
      const saved = getSavedApiConfig();
      providerConfig = getImageProviderConfig(saved, activeProvider);
      if (providerConfig && providerConfig.model) activeModel = providerConfig.model;
    } catch(e) {}
    // Update state to reflect resolved provider
    state.model = activeProvider;

    if (!providerConfig || !providerConfig.key) {
      alert('当前图片模型未配置 API Key，请先到设置页保存 Key 后再生成。');
      updateModelStatus();
      return;
    }
    if (!providerConfig.endpoint && !providerConfig.api_base) {
      alert('当前图片模型缺少 API 端点。自定义模型请填写类似 https://api.tu-zi.com/v1 的端点。');
      return;
    }
    if (!activeModel) {
      alert('当前图片模型缺少模型名，请在设置页填写模型名。');
      return;
    }

    state.generating = true;
    $('#genBtn').disabled = true;
    $('#genBtn').classList.add('generating');

    // 显示加载动画
    $('#emptyState').style.display = 'none';
    $('#previewWrap').style.display = 'none';
    $('#resultGrid').style.display = 'none';
    $('#genLoading').style.display = '';
    $('#progressBar').style.width = '10%';

    // 模拟进度
    let progress = 10;
    const progressTimer = setInterval(() => {
      progress = Math.min(progress + Math.random() * 15, 90);
      $('#progressBar').style.width = progress + '%';
    }, 800);

    try {
      const results = await generateWithConfiguredApi({
        provider: activeProvider,
        model: activeModel,
        endpoint: providerConfig.api_base || providerConfig.endpoint,
        key: providerConfig.key,
        prompt,
      });

      clearInterval(progressTimer);
      $('#progressBar').style.width = '100%';

      $('#genLoading').style.display = 'none';
      renderResults(results);
      saveToHistory(results, prompt);
    } catch (err) {
      clearInterval(progressTimer);
      $('#genLoading').style.display = 'none';
      alert('生成失败：' + err.message);
    } finally {
      state.generating = false;
      $('#genBtn').disabled = false;
      $('#genBtn').classList.remove('generating');
    }
  }

  // 模拟生成（实际项目删除此函数）
  function mockGenerate() {
    return new Promise((resolve) => setTimeout(resolve, 2000));
  }

  // 模拟结果（实际项目替换为真实图片）
  function generateMockResults() {
    const results = [];
    for (let i = 0; i < state.count; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = state.ratio === '9:16' ? 896 : state.ratio === '16:9' ? 288 : 512;
      const ctx = canvas.getContext('2d');
      const grd = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      grd.addColorStop(0, '#2A2A30');
      grd.addColorStop(1, '#1F1F24');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(255,255,255,0.02)';
      for (let j = 0; j < 300; j++) {
        ctx.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 1, 1);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.font = '14px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('AI 生成结果 ' + (i + 1), canvas.width / 2, canvas.height / 2);
      results.push({ url: canvas.toDataURL('image/png'), index: i });
    }
    return results;
  }

  // ========== 结果渲染 ==========
  function renderResults(results) {
    state.results = results;
    state.currentIndex = 0;
    const grid = $('#resultGrid');
    grid.style.display = 'grid';
    grid.innerHTML = '';
    $('#previewWrap').style.display = 'none';
    $('#emptyState').style.display = 'none';

    results.forEach((r, i) => {
      const item = document.createElement('div');
      item.className = 'result-item';
      item.innerHTML = `
        <img src="${r.url}" alt="结果${i + 1}" />
        <div class="result-actions">
          <button data-action="upscale">U${i + 1}</button>
          <button data-action="variant">V${i + 1}</button>
          <button data-action="save">保存</button>
          <button data-action="download">下载</button>
        </div>
      `;
      item.querySelector('img').addEventListener('click', () => {
        showModal(r.url);
      });
      item.querySelector('[data-action="upscale"]').addEventListener('click', () => {
        showModal(r.url);
      });
      item.querySelector('[data-action="variant"]').addEventListener('click', () => {
        makeVariant(r, i);
      });
      item.querySelector('[data-action="save"]').addEventListener('click', () => {
        saveToHistory([r], $('#promptInput').value.trim() || '保存结果');
        toast('已保存到素材库');
      });
      item.querySelector('[data-action="download"]').addEventListener('click', () => {
        downloadImage(r.url, `nextgen-${Date.now()}.jpg`);
      });
      grid.appendChild(item);
    });
  }

  function showPreview(url) {
    const idx = state.results.findIndex((r) => r.url === url);
    state.currentIndex = idx >= 0 ? idx : 0;
    $('#resultGrid').style.display = 'none';
    $('#emptyState').style.display = 'none';
    $('#previewWrap').style.display = '';
    $('#previewImg').src = url;
    updateEmptyStateText();
  }

  function makeVariant(result, index) {
    const variant = {
      url: generateMockResults()[0].url,
      index: state.results.length,
      parent: index,
    };
    state.results.splice(index + 1, 0, variant);
    renderResults(state.results);
  }

  function toast(message) {
    let node = document.querySelector('.editor-toast');
    if (!node) {
      node = document.createElement('div');
      node.className = 'editor-toast';
      document.body.appendChild(node);
    }
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(node._timer);
    node._timer = setTimeout(() => node.classList.remove('show'), 1600);
  }

  function downloadImage(url, filename) {
    const a = document.createElement('a');
    a.download = filename;
    a.href = url;
    a.click();
  }

  // ========== 图片上传（画布预览）==========
  function initImageUpload() {
    const container = $('#previewContainer');
    const emptyState = $('#emptyState');
    const input = $('#imageInput');
    const canUpload = () => {
      const activeTab = document.querySelector('.tab-btn.active');
      return (activeTab && activeTab.dataset.tab === 'edit') || state.mode === 'img2img' || state.mode === 'inpaint';
    };

    emptyState.addEventListener('click', (e) => {
      if (canUpload()) {
        input.click();
      }
    });
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (canUpload()) {
        emptyState.classList.add('dragover');
      }
    });
    container.addEventListener('dragleave', () => {
      emptyState.classList.remove('dragover');
    });
    container.addEventListener('drop', (e) => {
      e.preventDefault();
      emptyState.classList.remove('dragover');
      if (canUpload()) {
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) loadImageToCanvas(file);
      }
    });
    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) loadImageToCanvas(file);
    });

    $('#zoomBtn').addEventListener('click', () => {
      const current = state.results[state.currentIndex] || state.results[0];
      if (current) showModal(current.url);
    });
  }

  function loadImageToCanvas(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      state.results = [{ url: e.target.result, index: 0 }];
      $('#emptyState').style.display = 'none';
      $('#resultGrid').style.display = 'none';
      showPreview(e.target.result);
      $('#genLoading').style.display = 'none';
    };
    reader.readAsDataURL(file);
  }

  // ========== 蒙版画布 ==========
  function initMaskCanvas() {
    if (state.maskCanvasReady) return;
    state.maskCanvasReady = true;

    const canvas = $('#maskCanvas');
    const previewImg = $('#previewImg');
    const ctx = canvas.getContext('2d');
    let drawing = false;

    function resizeCanvas() {
      const img = previewImg;
      if (!img.src || !img.naturalWidth) return;
      canvas.width = img.clientWidth;
      canvas.height = img.clientHeight;
    }

    const sizes = { small: 20, medium: 40, large: 80 };

    canvas.addEventListener('mousedown', (e) => {
      drawing = true;
      ctx.globalCompositeOperation = 'source-over';
    });
    canvas.addEventListener('mousemove', (e) => {
      if (!drawing) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      ctx.beginPath();
      ctx.arc(x, y, sizes[state.brushSize] / 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 0, 0, 0.6)';
      ctx.fill();
    });
    canvas.addEventListener('mouseup', () => { drawing = false; });
    canvas.addEventListener('mouseleave', () => { drawing = false; });

    previewImg.addEventListener('load', resizeCanvas);
    if (previewImg.src) resizeCanvas();
  }

  // ========== 图片调整 ==========
  function initEditPanel() {
    $$('.preset-tag').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.preset-tag').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        applyPreset(btn.dataset.preset);
      });
    });

    [
      { id: 'brightness', val: 'brightVal' },
      { id: 'contrast', val: 'contrastVal' },
      { id: 'saturation', val: 'satVal' },
      { id: 'temperature', val: 'tempVal' },
    ].forEach(({ id, val }) => {
      const slider = $(`#${id}`);
      slider.addEventListener('input', () => {
        $(`#${val}`).textContent = slider.value;
        applyFilter();
      });
    });

    $('#resetBtn').addEventListener('click', () => {
      ['brightness', 'contrast', 'saturation', 'temperature'].forEach((id) => {
        $(`#${id}`).value = 0;
      });
      ['brightVal', 'contrastVal', 'satVal', 'tempVal'].forEach((id) => {
        $(`#${id}`).textContent = '0';
      });
      applyFilter();
    });

    $('#downloadBtn').addEventListener('click', () => {
      const current = state.results[state.currentIndex];
      if (current) downloadImage(current.url, `nextgen-adjusted-${Date.now()}.jpg`);
    });
  }

  function applyFilter() {
    const img = $('#previewImg');
    if (!img.src) return;
    const b = 100 + parseInt($('#brightness').value);
    const c = 100 + parseInt($('#contrast').value);
    const s = 100 + parseInt($('#saturation').value);
    const t = parseInt($('#temperature').value);
    img.style.filter = `brightness(${b}%) contrast(${c}%) saturate(${s}%) hue-rotate(${t}deg)`;
  }

  function applyPreset(p) {
    const presets = {
      original: [0, 0, 0, 0],
      bright: [30, 10, 15, 10],
      vivid: [10, 30, 50, 0],
      warm: [15, 5, 0, 20],
      cool: [5, 10, -20, -15],
      bw: [0, 10, -100, 0],
    };
    const v = presets[p] || presets.original;
    $('#brightness').value = v[0]; $('#brightVal').textContent = v[0];
    $('#contrast').value = v[1]; $('#contrastVal').textContent = v[1];
    $('#saturation').value = v[2]; $('#satVal').textContent = v[2];
    $('#temperature').value = v[3]; $('#tempVal').textContent = v[3];
    applyFilter();
  }

  // ========== 全屏预览 ==========
  function initModal() {
    $('#modalClose').addEventListener('click', () => {
      $('#modal').style.display = 'none';
    });
    $('#modal').addEventListener('click', (e) => {
      if (e.target === $('#modal')) $('#modal').style.display = 'none';
    });
    $('#modalSave').addEventListener('click', () => {
      const current = state.results[state.currentIndex];
      if (current) saveToHistory([current], '保存');
    });
    $('#modalDownload').addEventListener('click', () => {
      if (state.modalImageUrl) {
        downloadImage(state.modalImageUrl, `nextgen-${Date.now()}.jpg`);
      }
    });
  }

  function showModal(url) {
    state.modalImageUrl = url;
    const idx = state.results.findIndex((r) => r.url === url);
    if (idx >= 0) state.currentIndex = idx;
    $('#modalImg').src = url;
    $('#modal').style.display = '';
    $('#emptyState').style.display = 'none';
  }

  // ========== 历史记录 ==========
  function initHistory() {
    $('#historyBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      const drawer = $('#historyDrawer');
      drawer.style.display = drawer.style.display === 'none' ? '' : 'none';
    });
    $('#historyDrawer').addEventListener('click', (e) => {
      e.stopPropagation();
    });
    $('#clearHistoryBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      state.history = [];
      localStorage.removeItem('nextgen_history');
      renderHistory();
    });
    document.addEventListener('click', (e) => {
      const drawer = $('#historyDrawer');
      if (drawer.style.display !== 'none' && !drawer.contains(e.target) && !e.target.closest('#historyBtn')) {
        drawer.style.display = 'none';
      }
    });
  }

  function loadHistory() {
    try {
      const saved = localStorage.getItem('nextgen_history');
      if (saved) state.history = JSON.parse(saved);
    } catch (e) { /* ignore */ }
    renderHistory();
  }

  function saveToHistory(results, prompt) {
    results.forEach((r) => {
      state.history.unshift({
        url: r.url,
        prompt: prompt || '图片调整',
        time: new Date().toLocaleString('zh-CN'),
      });
    });
    if (state.history.length > 50) state.history = state.history.slice(0, 50);
    try {
      localStorage.setItem('nextgen_history', JSON.stringify(state.history));
    } catch (e) { /* ignore */ }

    // Also write to unified asset library
    try {
      const assets = JSON.parse(localStorage.getItem('nextgen_assets') || '[]');
      results.forEach((r) => {
        assets.unshift({
          type: 'image',
          url: r.url,
          prompt: prompt || '图片调整',
          time: new Date().toISOString(),
          id: 'img_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
        });
      });
      if (assets.length > 100) assets.length = 100;
      localStorage.setItem('nextgen_assets', JSON.stringify(assets));
    } catch (e) { /* ignore */ }

    renderHistory();
  }

  function renderHistory() {
    const list = $('#historyList');
    list.innerHTML = '';
    state.history.slice(0, 20).forEach((h, i) => {
      const item = document.createElement('div');
      item.className = 'history-item';
      item.innerHTML = `
        <img src="${h.url}" alt="历史${i + 1}" />
        <div class="history-item-info">
          <div class="history-prompt">${h.prompt}</div>
          <div class="history-time">${h.time}</div>
        </div>
      `;
      item.addEventListener('click', () => {
        showModal(h.url);
        $('#historyDrawer').style.display = 'none';
      });
      list.appendChild(item);
    });
  }

  // ========== 启动 ==========
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
