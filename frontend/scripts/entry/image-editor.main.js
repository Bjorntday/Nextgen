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
    loadHistory();
    updateEmptyStateText();
    updateCanvasStatus();
    loadTemplate();
  }

  function loadTemplate() {
    try {
      const t = JSON.parse(localStorage.getItem('nextgen_template'));
      if (!t) return;
      if (t.prompt) $('#promptInput').value = t.prompt;
      if (t.style) {
        const btn = document.querySelector('.preset-btn[data-style="' + t.style + '"]');
        if (btn) btn.click();
      }
      if (t.mode) {
        const tab = document.querySelector('.mode-tab[data-mode="' + t.mode + '"]');
        if (tab) tab.click();
      }
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

  function parseProviderModel(value, fallbackProvider, fallbackModel) {
    const parts = String(value || '').split(':');
    const provider = parts.shift() || fallbackProvider;
    return {
      provider,
      model: parts.join(':') || fallbackModel || '',
    };
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
      cfg = JSON.parse(localStorage.getItem('nextgen_api_config') || '{}');
      const parsedDefault = parseProviderModel(cfg.defaults && cfg.defaults.image, 'jimeng', 'jimeng-5.0');
      defaultProvider = parsedDefault.provider;
      defaultModelName = parsedDefault.model;
      const imageKeys = cfg.image || {};
      Object.keys(imageKeys).forEach(pid => {
        if (imageKeys[pid] && imageKeys[pid].key) configuredProviders.push(pid);
      });
    } catch(e) {}

    // Always include default if not already present
    if (!configuredProviders.includes(defaultProvider)) configuredProviders.unshift(defaultProvider);
    // Always include jimeng as fallback
    if (!configuredProviders.includes('jimeng')) configuredProviders.unshift('jimeng');

    // Render chips
    configuredProviders.slice(0, 6).forEach(pid => {
      const name = IMAGE_PROVIDER_MAP[pid] || pid;
      const providerModel = (cfg.image && cfg.image[pid] && cfg.image[pid].model)
        ? cfg.image[pid].model
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
      countField.style.display = 'none';
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
    $('#randomBtn').addEventListener('click', () => {
      const prompts = [
        '精致礼盒包装，特写镜头，柔光箱照明，4K高清',
        '女士手提包，模特场景，街拍风格，自然日光',
        '运动跑鞋，产品特写，深色背景，专业运动摄影',
        '护肤精华液，透明瓶身，实验室风格，简洁背景',
        '茶叶包装，中国风，竹背景，传统工艺',
      ];
      $('#promptInput').value = prompts[Math.floor(Math.random() * prompts.length)];
    });
    $('#clearPromptBtn').addEventListener('click', () => {
      $('#promptInput').value = '';
      $('#promptInput').focus();
    });
  }

  // ========== 参考图上传 ==========
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
    });
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
    try {
      const cfg = JSON.parse(localStorage.getItem('nextgen_api_config') || '{}');
      const provider = (cfg.image || {})[state.model];
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
    if (link) link.href = `/pages/settings.html#image-models-${state.model}`;
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
    let apiConfig = { image: {}, defaults: { image: 'jimeng:jimeng-5.0' } };
    let activeProvider = state.model || 'jimeng';
    let activeModel = 'jimeng-5.0';
    try {
      const saved = JSON.parse(localStorage.getItem('nextgen_api_config') || '{}');
      if (saved) apiConfig = saved;
      const provData = (saved.image||{})[activeProvider];
      if (provData && provData.key) {
        // Use configured provider + model
        activeModel = provData.model || (saved.defaults.image||'').split(':')[1] || 'latest';
      } else {
        // Fallback to defaults
        const parts = (saved.defaults.image || 'jimeng:jimeng-5.0').split(':');
        activeProvider = parts[0];
        activeModel = parts[1] || 'latest';
      }
    } catch(e) {}
    // Update state to reflect resolved provider
    state.model = activeProvider;

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
      // 模拟API调用（实际项目替换为真实API）
      await mockGenerate();

      clearInterval(progressTimer);
      $('#progressBar').style.width = '100%';

      // 生成模拟结果（实际项目替换为真实图片URL）
      const results = generateMockResults();

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
