import { loadRefImageList, saveRefImageList } from '../modules/image-editor/ref-storage.js';

/**
 * NextGen Image Studio - 完整JS逻辑
 * 文生图 / 图生图 / 局部重绘 / 图片调整 / 历史记录
 */

import { addAsset } from "../shared/asset-store.js";

(function () {
  // ========== DOM 工具 ==========
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  // ========== 状态 ==========
  let state = {
    generating: false,
    mode: 'txt2img',           // txt2img | img2img | inpaint
    workflowMode: false,
    model: 'jimeng',
    style: '',
    // Reference images are isolated by feature group:
    // baseRefImages = 文生图/图生图/局部重绘基础能力；workflowRefImages = 外贸商品工作流。
    // Backward-compat: refImage / refImageName are still read for legacy localStorage.
    baseRefImages: [],
    workflowRefImages: [],
    refImages: [],
    refImage: null,            // legacy single-image field (deprecated, kept for restore compat)
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

  function getActiveRefStore() {
    return state.workflowMode ? state.workflowRefImages : state.baseRefImages;
  }

  function syncLegacyRefFields(items = getActiveRefStore()) {
    state.refImages = items || [];
    state.refImage = state.refImages[0]?.dataUrl || null;
    state.refImageName = state.refImages[0]?.name || '';
  }

  function syncActiveRefImages() {
    syncLegacyRefFields(getActiveRefStore());
  }

  function commitActiveRefImages(items = state.refImages || []) {
    if (state.workflowMode) {
      state.workflowRefImages = items;
    } else {
      state.baseRefImages = items;
    }
    syncLegacyRefFields(items);
  }

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
      if (t.prompt) {
        $('#promptInput').value = t.prompt;
        persistBasePrompt();
      }
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
      edit_model: custom.edit_model || custom.image_model || '',
      endpoint: custom.endpoint || '',
      api_base: custom.endpoint || '',
      custom: true,
    };
  }

  function getGenerationSourceImages() {
    syncActiveRefImages();
    if (state.mode === 'img2img') {
      const items = (state.refImages || []).map((it) => it && it.dataUrl).filter(Boolean);
      return items.length ? items : (state.refImage ? [state.refImage] : []);
    }
    if (state.mode === 'inpaint') {
      const current = state.results[state.currentIndex] || state.results[0];
      return current && current.url ? [current.url] : [];
    }
    return [];
  }

  function getProductRefImages() {
    syncActiveRefImages();
    return (state.refImages || []).filter((it) => it && it.dataUrl && !it.isSwatch);
  }

  function getWorkflowHistoryLabel() {
    if (!state.workflowMode) return '';
    const key = getActiveWorkflowKey();
    const cfg = TRADE_WORKFLOWS[key] || null;
    return cfg ? cfg.title : '外贸商品工作流';
  }

  function getCurrentPromptLabel(fallback = '保存结果') {
    if (state.workflowMode) return getWorkflowHistoryLabel() || fallback;
    const promptInput = $('#promptInput');
    return (promptInput && promptInput.value.trim()) || fallback;
  }

  function resolveActiveImageConfig() {
    const activeProvider = state.model || 'jimeng';
    let activeModel = 'jimeng-5.0';
    let providerConfig = null;
    try {
      const saved = getSavedApiConfig();
      providerConfig = getImageProviderConfig(saved, activeProvider);
      if (providerConfig && (providerConfig.model || providerConfig.edit_model)) {
        activeModel = getProviderModelForMode(providerConfig, state.mode);
      }
    } catch(e) {}
    return { activeProvider, activeModel, providerConfig };
  }

  function resolveImageModelForMode(model, mode = state.mode) {
    const m = String(model || '').trim();
    return mode !== 'txt2img' && m.toLowerCase().endsWith('-vip') ? m.slice(0, -4) : m;
  }

  function getProviderModelForMode(providerConfig, mode = state.mode) {
    const baseModel = providerConfig && providerConfig.model ? providerConfig.model : '';
    if (mode !== 'txt2img' && providerConfig && providerConfig.edit_model) {
      return providerConfig.edit_model;
    }
    return resolveImageModelForMode(baseModel, mode);
  }

  async function generateWithConfiguredApi({ provider, model, endpoint, key, prompt, mode, count, images, mask, ratio }) {
    const body = {
      endpoint,
      api_key: key,
      model,
      prompt,
      mode: mode || state.mode,
      count: count || state.count,
      ratio: ratio || state.ratio,
    };
    const sourceImages = images || getGenerationSourceImages();
    if (body.mode !== 'txt2img') {
      body.images = sourceImages;
      body.image = sourceImages[0] || '';
    }
    const maskData = mask || state.maskData;
    if (body.mode === 'inpaint' && maskData) body.mask = maskData;

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
    const resultImages = Array.isArray(data.images) ? data.images : [];
    if (!resultImages.length) throw new Error('接口没有返回图片结果');
    const resolvedModel = data.model || resolveImageModelForMode(model, body.mode);
    return resultImages.map((img, index) => ({ url: img.url || img.data_url, index, provider, model: resolvedModel }));
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
        state.workflowMode = false;
        $$('.workflow-tab').forEach((b) => b.classList.remove('active'));
        syncActiveRefImages();
        restoreBasePrompt();
        updateModeUI();
        renderRefGrid();
        updateWorkflowPanelVisibility();
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
    updatePromptPlaceholder();
    updateGenHint();
    updateModelStatus();
    updateCanvasStatus();
  }

  const TRADE_WORKFLOWS = {
    cutout: {
      mode: 'img2img',
      title: 'AI 高清扣图 + 批量整理 + Excel 导出',
      desc: '适合外贸报价、工厂推广和电商运营。先把随手拍产品图处理成干净主图，再整理成可导出的资料。',
      prompt: '只对上传的产品照片做背景抠除和背景整理：商品主体必须与原图一致，不重新设计、不改变形状、颜色、材质、纹理、比例、角度和细节。',
    },
    variants: {
      mode: 'img2img',
      title: '外贸产品裂变：1 个爆款延伸多款新品',
      desc: '适合新品开发、客户提案和电商上新。基于一个爆款，按元素、图案、配色方向快速扩展多款方案。',
      prompt: '基于参考产品做同一母款的系列化变体：必须保留产品品类、轮廓、结构、比例、角度和核心卖点，只在指定方向做可生产的小幅变化。',
    },
    apply: {
      mode: 'img2img',
      title: '图案快速应用 + 指定 Pantone 色号预览',
      desc: '适合客户确认设计方向。把图案、想法或色号快速应用到产品上，几分钟看到接近打样的效果。',
      prompt: '将指定图案和 Pantone 色号应用到参考产品上，保持产品形状、材质和真实光影，生成可展示的产品效果图。颜色准确，图案贴合产品表面，不变形。',
    },
  };

  function getActiveWorkflowKey() {
    return document.querySelector('.workflow-tab.active')?.dataset.workflow || 'cutout';
  }

  function getFieldValue(id, fallback = '') {
    const el = document.getElementById(id);
    return el ? (el.value || fallback) : fallback;
  }

  function labelFromSelect(id) {
    const el = document.getElementById(id);
    return el && el.selectedOptions && el.selectedOptions[0] ? el.selectedOptions[0].textContent.trim() : '';
  }

  function buildWorkflowPrompt() {
    syncActiveRefImages();
    const key = getActiveWorkflowKey();
    if (key === 'cutout') {
      const bg = labelFromSelect('cutoutBg') || '纯白';
      const edge = labelFromSelect('cutoutEdge') || '干净硬边';
      const batch = labelFromSelect('cutoutBatch') || '每张单独';
      return [
        '这是商品抠图 / 背景清理任务，不是重新生成商品。',
        '请以上传图片中的商品为唯一主体，只移除或替换背景。',
        `背景方案：${bg}；边缘处理：${edge}；批量策略：${batch}。`,
        '必须严格保持商品主体与原图一致：形状、轮廓、颜色、材质、纹理、图案、文字、配件、比例、透视角度、摆放姿态和局部细节都不要改变。',
        '只允许处理商品外部背景和边缘过渡；可以补干净背景、自然阴影或透明底，但不能重绘、改款、扩写、替换、简化或美化商品本体。',
        '不要新增道具、场景、文字、水印、标签、Logo 或装饰元素；不要改变商品品类；不要改变构图主体位置。'
      ].join('');
    }
    if (key === 'variants') {
      const count = getFieldValue('variantsCount', '8');
      const axis = labelFromSelect('variantsAxis') || '混合方向';
      const strength = labelFromSelect('variantsStrength') || '中等发散';
      const axisRules = {
        color: '只改变配色方案，不改变图案、结构、材质、轮廓、比例、角度和功能部件。',
        pattern: '只改变表面图案 / 印花 / 局部装饰，不改变产品结构、材质、轮廓、比例、角度和基础配色关系。',
        mixed: '可以在配色、图案和局部装饰上做组合变化，但必须保持同一母款、同一结构、同一品类和同一产品识别度。',
      };
      const strengthRules = {
        subtle: '变化幅度保守，像同一款产品的不同色号或轻微图案版本。',
        medium: '变化幅度中等，像同一系列里的不同 SKU，差异清晰但仍然一眼看出是同一母款。',
        wild: '变化幅度可以更明显，但仍不能改变商品大类、结构轮廓、功能部件和可生产逻辑。',
      };
      const axisKey = getFieldValue('variantsAxis', 'mixed');
      const strengthKey = getFieldValue('variantsStrength', 'medium');
      return [
        '这是产品系列裂变任务，不是重新设计一个全新商品。',
        '请把上传图片中的商品作为“母款”，保持它的品类、轮廓、结构、比例、角度、材质逻辑、核心卖点和商业可生产感。',
        `输出一张整齐的系列方案图，画面中展示 ${count} 个同一母款的变体 SKU。`,
        `变化方向：${axis}；风格强度：${strength}。`,
        axisRules[axisKey] || axisRules.mixed,
        strengthRules[strengthKey] || strengthRules.medium,
        '每个变体之间要有可辨识差异，但必须像同一个产品系列；不要改变商品大类，不要改成其他物品，不要增加无关场景、模特、文字、水印、Logo 或复杂背景。',
        '构图要求：干净背景，多个变体有序排列，方便客户对比选款。'
      ].join('');
    }
    const hex = (document.getElementById('colorActiveHex')?.value || colorPanelState.active?.hex || '').trim();
    const colorName = (document.getElementById('colorActiveName')?.value || colorPanelState.active?.name || '').trim();
    const colorText = hex ? `${colorName || '指定色号'} ${hex.toUpperCase()}` : '当前选定图案和色号';
    const hasSwatch = (state.refImages || []).some((it) => it && it.isSwatch);
    // When a color swatch is attached as figure 2, the prompt must
    // explicitly tell the model "图 1 = product, 图 2 = color sample" —
    // otherwise the model has to guess which is which.
    if (hasSwatch) {
      return [
        '这是一个多图参考任务。',
        '图 1 是商品主图（要保留的产品）；图 2 是色号 / 图案样板（要应用上去的视觉参考）。',
        `将图 2 中的色号 / 图案应用到图 1 中的商品上。色号说明：${colorText}。`,
        '保持图 1 商品的形状、材质、比例、真实光影、原始构图和商品大类不变；',
        '只在指定区域替换或叠加图 2 的颜色 / 图案，纹理比例与透视方向自然，贴合产品表面，不拉伸、不扭曲；',
        '不要改变整体光照方向、场景结构、色调风格，不要引入新元素、不要加入文字或水印。'
      ].join('');
    }
    return [
      `将${colorText}应用到上传的参考商品上。`,
      '保持商品形状、材质、比例、真实光影和原始构图不变，只替换或应用指定图案/颜色区域。',
      '颜色要准确，纹理比例与透视方向自然，贴合产品表面，不拉伸、不扭曲；不要改变整体光照方向、场景结构、色调风格，不要引入新元素。'
    ].join('');
  }

  function syncWorkflowPrompt() {
    const promptInput = $('#promptInput');
    if (!promptInput) return;
    const prompt = buildWorkflowPrompt();
    promptInput.value = prompt;
    try { localStorage.setItem(WORKFLOW_PROMPT_LS_KEY, prompt); } catch (_e) {}
  }

  function selectImageMode(mode) {
    const modeTab = document.querySelector('.mode-tab[data-mode="' + mode + '"]');
    if (modeTab) {
      $$('.mode-tab').forEach((b) => b.classList.remove('active'));
      modeTab.classList.add('active');
    }
    state.mode = mode;
    updateModeUI();
  }

  function removeInjectedColorSwatches() {
    syncActiveRefImages();
    const before = (state.refImages || []).length;
    state.refImages = (state.refImages || []).filter((it) => !(it && it.isSwatch));
    if (state.refImages.length !== before) {
      commitActiveRefImages(state.refImages);
      renderRefGrid();
      persistRefImages();
    }
  }

  function initTradeWorkflow() {
    const root = $('#tradeWorkflow');
    if (!root) return;
    const titleNode = $('#workflowTitle');
    const descNode = $('#workflowDesc');

    function activate(key, applyPrompt = false) {
      const cfg = TRADE_WORKFLOWS[key] || TRADE_WORKFLOWS.cutout;
      state.workflowMode = true;
      syncActiveRefImages();
      if (key !== 'apply') removeInjectedColorSwatches();
      $$('.workflow-tab').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.workflow === key);
      });
      if (titleNode) titleNode.textContent = cfg.title;
      if (descNode) descNode.textContent = cfg.desc;
      try { localStorage.setItem(WORKFLOW_LS_KEY, key); } catch (_e) {}
      try { updateWorkflowPanelVisibility(); } catch (_e) {}
      renderRefGrid();
      syncWorkflowPrompt();
      if (!applyPrompt) return;

      selectImageMode(cfg.mode);
      state.workflowMode = true;
      $$('.workflow-tab').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.workflow === key);
      });
      updateWorkflowPanelVisibility();
      renderRefGrid();
      syncWorkflowPrompt();
      updateGenHint();
      updateCanvasStatus();
    }

    $$('.workflow-tab').forEach((btn) => {
      btn.addEventListener('click', () => activate(btn.dataset.workflow, true));
    });

    root.querySelector('[data-action="need-ref"]')?.addEventListener('click', () => {
      const active = root.querySelector('.workflow-tab.active');
      const key = active?.dataset.workflow || 'cutout';
      const mode = 'img2img';
      state.workflowMode = true;
      syncActiveRefImages();
      if (key !== 'apply') removeInjectedColorSwatches();
      selectImageMode(mode);
      state.workflowMode = true;
      syncActiveRefImages();
      $$('.workflow-tab').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.workflow === key);
      });
      updateWorkflowPanelVisibility();
      renderRefGrid();
      syncWorkflowPrompt();
      updateGenHint();
      updateCanvasStatus();
      $('#refInput')?.click();
    });

    root.querySelectorAll('.wf-panel select, .wf-panel input').forEach((control) => {
      control.addEventListener('change', syncWorkflowPrompt);
      control.addEventListener('input', syncWorkflowPrompt);
    });

    // Restore workflow copy, but do not enter workflow mode on page load.
    try {
      const lastKey = localStorage.getItem(WORKFLOW_LS_KEY);
      if (lastKey && TRADE_WORKFLOWS[lastKey]) {
        const cfg = TRADE_WORKFLOWS[lastKey];
        if (titleNode) titleNode.textContent = cfg.title;
        if (descNode) descNode.textContent = cfg.desc;
      }
    } catch (_e) {}
    state.workflowMode = false;
    syncActiveRefImages();
    $$('.workflow-tab').forEach((btn) => btn.classList.remove('active'));
    renderRefGrid();
    updateWorkflowPanelVisibility();
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

  function normalizeHexColor(value) {
    let hex = String(value || '').trim();
    if (!hex) return '';
    if (!hex.startsWith('#')) hex = '#' + hex;
    return /^#([0-9a-fA-F]{6})$/.test(hex) ? hex.toUpperCase() : '';
  }

  function syncActiveColorToWorkflow() {
    if (state.workflowMode && getActiveWorkflowKey() === 'apply') {
      syncWorkflowPrompt();
    }
  }

  function setActiveColor({ name = '', hex }, { toastMessage = '' } = {}) {
    const normalized = normalizeHexColor(hex);
    if (!normalized) return false;
    colorPanelState.active = { name, hex: normalized };
    renderColorActive();
    renderColorPalette();
    saveColorPanelState();
    syncActiveColorToWorkflow();
    if (toastMessage) toast(toastMessage);
    return true;
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
      btn.addEventListener('click', () => setActiveColor({ name: c.name, hex: c.hex }));
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
        setActiveColor({ name: c.name, hex: c.hex });
      });
      list.appendChild(btn);
    });
  }

  function updateColorPanelVisibility() {
    const panel = $('#colorPanel') || $('#wfPanelApply');
    if (!panel) return;
    const activeTab = document.querySelector('.workflow-tab.active');
    const isApply = state.workflowMode && activeTab && activeTab.dataset.workflow === 'apply';
    panel.hidden = !isApply;
  }

  function updateWorkflowPanelVisibility() {
    const active = document.querySelector('.workflow-tab.active')?.dataset.workflow || 'cutout';
    $$('.wf-panel').forEach((panel) => {
      panel.hidden = !state.workflowMode || panel.dataset.wf !== active;
    });
    updateRefUploadCopy();
    const promptSection = document.querySelector('.prompt-section');
    if (promptSection) promptSection.hidden = !!state.workflowMode;
    updateColorPanelVisibility();
  }

  function updateRefUploadCopy() {
    const title = document.querySelector('.ref-upload-title');
    const hint = document.querySelector('.ref-upload-hint');
    if (!title || !hint) return;
    const active = state.workflowMode ? getActiveWorkflowKey() : '';
    if (active === 'cutout') {
      title.textContent = '上传产品图（可多选）';
      hint.textContent = '支持 JPG / PNG / WebP · 高清扣图将逐张处理';
    } else if (active === 'apply') {
      title.textContent = '上传产品图 / 图案参考';
      hint.textContent = '第 1 张为产品图，可继续添加图案或色号样板';
    } else if (active === 'variants') {
      title.textContent = '上传产品参考图（可多选）';
      hint.textContent = '支持 JPG / PNG / WebP · 用于生成裂变方案';
    } else {
      title.textContent = '上传参考图（可多选）';
      hint.textContent = '支持 JPG / PNG / WebP · 拖拽多张到此处';
    }
  }

  function appendColorToPrompt() {
    const c = colorPanelState.active;
    if (!c || !c.hex) return;
    saveColorPanelState();
    // For the "图案色号应用" workflow, synthesize a Pantone-style swatch
    // image from the selected color and inject it as the 2nd reference
    // image (图 2 = 色号样板) BEFORE rebuilding the prompt, so the prompt
    // builder can see the swatch and switch to the multi-image wording.
    if (getActiveWorkflowKey() === 'apply') {
      state.workflowMode = true;
      syncActiveRefImages();
      const swatch = buildColorSwatchDataUrl(c.hex, c.name);
      if (swatch) injectColorSwatchAsRefImage(swatch, c);
    }
    syncWorkflowPrompt();
    toast('已应用到当前方案（含色号样板图）');
  }

  /**
   * Build a Pantone-style color chip image entirely on the client (no API call).
   * Returns a PNG data URL of size 512x512 with:
   *   - top 75%: large solid color block (the swatch)
   *   - bottom 25%: white label area with hex + name
   */
  function buildColorSwatchDataUrl(hex, name) {
    try {
      const norm = normalizeHexColor(hex);
      if (!norm) return '';
      const W = 512, H = 512;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      // White background
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, H);
      // Color block
      const blockH = Math.round(H * 0.72);
      ctx.fillStyle = norm;
      ctx.fillRect(0, 0, W, blockH);
      // Subtle inner border for definition
      ctx.strokeStyle = 'rgba(0,0,0,0.06)';
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, W, blockH);
      // Label area
      const labelY = blockH;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, labelY, W, H - labelY);
      // Hex text
      ctx.fillStyle = '#1D1D1F';
      ctx.font = '600 36px "Inter", -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillText(norm, 28, labelY + 22);
      // Name text (or default)
      const label = (name || '').trim() || 'Pantone 色号';
      ctx.fillStyle = '#6E6E73';
      ctx.font = '500 20px "Inter", -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillText(label, 28, labelY + 72);
      // Footer mark
      ctx.fillStyle = '#99999D';
      ctx.font = '500 14px "Inter", -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('Color Swatch · NextGen', W - 28, H - 26);
      return canvas.toDataURL('image/png');
    } catch (e) {
      console.warn('[color-swatch] generate failed', e);
      return '';
    }
  }

  /**
   * Inject the synthesized color swatch as the 2nd reference image.
   * If a previous swatch exists, replace it; otherwise append.
   */
  function injectColorSwatchAsRefImage(dataUrl, color) {
    if (!dataUrl) return;
    syncActiveRefImages();
    const items = state.refImages = state.refImages || [];
    const tag = 'swatch:';
    // Remove any previously-injected swatches.
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i] && items[i].name && items[i].name.startsWith(tag)) items.splice(i, 1);
    }
    // The product image (figure 1) must come first. If there's no user
    // upload yet, just put the swatch alone and let the prompt handle it.
    const swatchItem = {
      name: tag + (color.name || '色号') + ' ' + color.hex,
      dataUrl,
      mime: 'image/png',
      isSwatch: true,
    };
    // Insert as the 2nd image: product first, swatch second.
    if (items.length === 0) items.push(swatchItem);
    else items.splice(1, 0, swatchItem);
    // Cap
    if (items.length > MAX_REF_IMAGES) items.length = MAX_REF_IMAGES;
    commitActiveRefImages(items);
    try { renderRefGrid?.(); } catch (_e) {}
    try { persistRefImages?.(); } catch (_e) {}
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
    syncActiveRefImages();
    pickerModalState = { imageDataUrl: null, pendingHex: null, pendingCoord: null };
    // Show "从已上传参考图取色" only when ref image exists.
    const fromRefBtn = $('#colorPickFromRefBtn');
    if (fromRefBtn) fromRefBtn.hidden = !state.refImage;
    // Visually de-emphasize system picker if EyeDropper API is unavailable,
    // but DO NOT disable the button — clicking it must still give the user a
    // clear message and offer the alternative flows.
    const sysBtn = $('#colorPickNativeBtn');
    if (sysBtn) {
      const supported = typeof window !== 'undefined' && 'EyeDropper' in window;
      sysBtn.dataset.supported = supported ? '1' : '0';
      sysBtn.title = supported
        ? '从屏幕任意位置取色'
        : '当前浏览器不支持系统取色器，点击查看替代方案';
      sysBtn.classList.toggle('is-unsupported', !supported);
      // Update the visible label so the user knows what will happen.
      const label = sysBtn.querySelector('.color-pick-native-label');
      if (label) {
        label.textContent = supported ? '系统取色器（屏幕）' : '系统取色器（不支持）';
      }
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
    setActiveColor({ name: '取色', hex }, { toastMessage: '已取色并应用到当前方案' });
    closeColorPickModal();
  }

  async function startNativeEyeDropper() {
    if (typeof window === 'undefined' || !('EyeDropper' in window)) {
      // Fallback: explain and offer alternative flows.
      showColorPickerToast(
        '当前浏览器不支持系统取色器（仅 Chromium 95+ 桌面版支持）。请改用：\n' +
        '• 「上传图片取色」上传任意图片后点击取色\n' +
        '• 「从已上传参考图取色」从已有图取色\n' +
        '• 直接在 HEX / 色号输入框手动填写',
        'warn'
      );
      return;
    }
    // Close the picker modal *before* showing the OS loupe. In Chromium, the
    // EyeDropper magnifier is layered above the page, but a high-z-index
    // modal sitting in front of the page can occlude it or, in some Chromium
    // versions, prevent the loupe from receiving the click — making the
    // user think "the button does nothing". Closing the modal first lets
    // the loupe appear against a clean page and reliably receive the click.
    closeColorPickModal();
    try {
      const dropper = new window.EyeDropper();
      // The browser shows its own full-screen magnifier; once the user clicks
      // anywhere on the page (including outside this app), it returns the
      // sampled sRGB hex of the pixel under the cursor.
      const result = await dropper.open();
      const hex = (result?.sRGBHex || '').toUpperCase();
      if (hex) {
        setActiveColor({ name: '屏幕取色', hex }, { toastMessage: '已取色并应用到当前方案' });
      }
    } catch (err) {
      // User cancelled (pressed Esc) — modal is already closed, no need to reopen.
      // We only log to console; a modal toast is unnecessary because the user
      // already saw the OS-level "cancelled" indicator.
      if (err && err.name !== 'AbortError') {
        console.warn('[eyedropper] failed:', err);
      }
    }
  }

  function showColorPickerToast(message, level = 'info') {
    const old = document.getElementById('colorPickerToast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.id = 'colorPickerToast';
    el.className = 'color-picker-toast color-picker-toast--' + level;
    el.textContent = message;
    el.addEventListener('click', () => el.remove());
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('is-out'), 6000);
    setTimeout(() => el.remove(), 6500);
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
    const panel = $('#colorPanel') || $('#wfPanelApply');
    if (!panel) return;
    loadColorPanelState();
    renderColorPalette();
    renderColorActive();
    renderSavedColors();
    updateColorPanelVisibility();

    // Hex input — live update swatch
    const hexInput = $('#colorActiveHex');
    hexInput?.addEventListener('input', () => {
      const v = normalizeHexColor(hexInput.value);
      if (v) {
        colorPanelState.active.hex = v;
        colorPanelState.active.name = $('#colorActiveName')?.value || colorPanelState.active.name || '';
        renderColorActive();
        renderColorPalette();
        saveColorPanelState();
        syncActiveColorToWorkflow();
      }
    });
    // Name input
    const nameInput = $('#colorActiveName');
    nameInput?.addEventListener('input', () => {
      colorPanelState.active.name = nameInput.value;
      saveColorPanelState();
      syncActiveColorToWorkflow();
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
      syncActiveRefImages();
      if (state.refImage) loadImageIntoStage(state.refImage);
    });
    $('#colorPickNativeBtn')?.addEventListener('click', startNativeEyeDropper);
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
      emptyTitle.textContent = state.workflowMode ? '上传产品图后开始处理' : '上传基础参考图';
      emptyHintText.textContent = state.workflowMode ? '请使用左侧工作流的上传产品图' : '可多选参考图，生成结果将在这里显示';
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
          if (!state.workflowMode) persistBasePrompt();
        }
      });
    });
  }

  // ========== 提示词 ==========
  function restoreBasePrompt() {
    const promptInput = $('#promptInput');
    if (!promptInput) return;
    const modeKey = `nextgen.imageEditor.basePrompt.${state.mode}`;
    try {
      const stored = localStorage.getItem(modeKey);
      promptInput.value = stored !== null
        ? stored
        : (state.mode === 'txt2img' ? (localStorage.getItem(BASE_PROMPT_LS_KEY) || '') : '');
    } catch (_e) {
      promptInput.value = '';
    }
  }

  function persistBasePrompt(mode = state.mode) {
    const promptInput = $('#promptInput');
    if (!promptInput) return;
    const modeKey = `nextgen.imageEditor.basePrompt.${mode}`;
    try {
      if (promptInput.value) localStorage.setItem(modeKey, promptInput.value);
      else localStorage.removeItem(modeKey);
      localStorage.removeItem(BASE_PROMPT_LS_KEY);
    } catch (_e) {}
  }

  const RANDOM_PROMPTS = {
    txt2img: [
      '一套高端护肤品礼盒，白色摄影棚背景，柔和顶光，玻璃瓶身通透，电商主图质感',
      '户外露营保温杯产品海报，清晨自然光，草地和木桌场景，真实商业摄影',
      '女士通勤手提包，浅灰背景，模特手持局部特写，皮革纹理清晰，高级品牌感',
      '运动跑鞋悬浮展示，深色渐变背景，动感光轨，鞋面材质细节锐利',
      '儿童玩具套装，明亮彩色背景，俯拍陈列，干净阴影，适合跨境电商详情页',
      '咖啡机产品主图，不锈钢机身，厨房台面场景，暖色晨光，真实反射',
      '无线耳机套装，极简科技风，浅蓝背景，产品悬浮排列，干净高光',
      '宠物用品组合，白底电商陈列，柔和阴影，主体清晰，包装与实物同框',
      '香薰蜡烛礼盒，暗调高级场景，火焰微光，木质桌面，生活方式摄影',
      '户外太阳镜产品图，沙滩阳光场景，镜片反光自然，夏季广告氛围',
      '不锈钢厨房刀具套装，黑色石纹背景，专业布光，锋利边缘清晰',
      '瑜伽服套装，模特室内自然站姿，柔和窗光，面料弹性和纹理真实',
    ],
    img2img: [
      '基于参考图优化成干净电商主图，保持商品结构和颜色不变，去除杂乱背景，增强材质细节和自然阴影',
      '参考原图生成同款产品的高级摄影版本，保留主体比例和关键卖点，背景改为简洁影棚场景',
      '将参考产品放入真实生活方式场景，保持产品外观一致，光影自然，适合详情页首图',
      '根据参考图生成一张更适合外贸报价单的产品图，白底、高清、边缘干净、无水印',
      '保留参考图商品主体，调整构图为居中展示，提升清晰度、对比度和商业质感',
      '以参考图为基础生成同系列营销图，增加柔和背景和轻微景深，不改变商品设计',
      '将参考产品转换为高级目录摄影风格，保持真实比例，突出材质纹理和工艺细节',
      '参考图中的产品不变，替换为浅色渐变背景，加入自然落地阴影，适合平台主图',
      '生成一张基于参考图的新品提案视觉，保持主体功能和结构，微调配色和陈列方式',
      '将参考图做成社媒广告风格，产品清晰占画面主体，背景有轻微场景氛围但不喧宾夺主',
      '基于参考图生成包装升级版本，保留产品品类和比例，提升画面整洁度和品牌感',
      '把参考图优化为高清产品特写，突出纹理、边缘、透明/金属/皮革等材质细节',
    ],
    inpaint: [
      '只修改涂抹区域，把瑕疵、污点和杂物自然移除，保持原图构图、光影、颜色和材质不变',
      '将涂抹区域替换为干净白色背景，边缘自然融合，不影响商品主体和阴影',
      '仅在涂抹区域添加柔和真实阴影，让商品落地更自然，其他区域保持原样',
      '把涂抹区域的文字、水印或标签去除，补全周围纹理，画面看不出修补痕迹',
      '只改变涂抹区域的颜色为更高级的中性色，保留原有纹理、褶皱、透视和光照',
      '将涂抹区域替换成同材质的完整表面，纹理方向一致，接缝自然，不引入新元素',
      '去除涂抹区域里的反光高亮或脏污，保留真实材质质感和整体明暗关系',
      '把涂抹区域改成指定产品图案的干净延展，保持透视和贴合关系自然',
      '仅重绘涂抹区域，让破损或遮挡部分恢复完整，其他所有内容保持不变',
      '把涂抹区域背景整理得更平整干净，保留原来的空间透视和光线方向',
      '对涂抹区域做局部精修，提高边缘清晰度和质感，不改变商品形状',
      '将涂抹区域改成更适合电商展示的简洁材质背景，主体、阴影和色调保持一致',
    ],
  };

  function getRandomPromptForMode(mode = state.mode) {
    const prompts = RANDOM_PROMPTS[mode] || RANDOM_PROMPTS.txt2img;
    return prompts[Math.floor(Math.random() * prompts.length)] || '';
  }

  function updatePromptPlaceholder() {
    const promptInput = $('#promptInput');
    if (!promptInput) return;
    const placeholders = {
      txt2img: '描述你想要生成的图片，例如：护肤品礼盒，白色背景，柔和摄影棚灯光，高级电商主图',
      img2img: '描述要如何参考已上传图片，例如：保持商品结构不变，优化为白底高清电商主图',
      inpaint: '描述涂抹区域要如何修改，例如：去除水印并自然补全背景，其他区域保持不变',
    };
    promptInput.placeholder = placeholders[state.mode] || placeholders.txt2img;
  }

  function initPromptInput() {
    const promptInput = $('#promptInput');
    // Restore last base prompt so page navigation/refresh doesn't wipe the user's text.
    restoreBasePrompt();
    updatePromptPlaceholder();
    if (promptInput) {
      promptInput.addEventListener('input', () => {
        if (!state.workflowMode) persistBasePrompt();
      });
    }
    $('#randomBtn').addEventListener('click', () => {
      const v = getRandomPromptForMode(state.mode);
      promptInput.value = v;
      persistBasePrompt();
    });
    $('#clearPromptBtn').addEventListener('click', () => {
      promptInput.value = '';
      promptInput.focus();
      persistBasePrompt();
    });
  }

  // ========== 参考图上传（支持多图） ==========
  const REF_IMAGES_LS_KEY = 'nextgen.imageEditor.refImages';
  const BASE_REF_IMAGES_LS_KEY = 'nextgen.imageEditor.baseRefImages';
  const WORKFLOW_REF_IMAGES_LS_KEY = 'nextgen.imageEditor.workflowRefImages';
  const REF_IMAGE_LS_KEY = 'nextgen.imageEditor.refImage';           // legacy
  const REF_IMAGE_NAME_LS_KEY = 'nextgen.imageEditor.refImageName'; // legacy
  const BASE_PROMPT_LS_KEY = 'nextgen.imageEditor.basePrompt';
  const WORKFLOW_PROMPT_LS_KEY = 'nextgen.imageEditor.workflowPrompt';
  const WORKFLOW_LS_KEY = 'nextgen.imageEditor.workflow';
  const MAX_REF_IMAGES = 8;

  function normalizeRefImages(items) {
    if (!Array.isArray(items)) return [];
    return items
      .filter((r) => r && r.dataUrl)
      .slice(0, MAX_REF_IMAGES)
      .map((r) => ({
        name: r.name || 'image',
        dataUrl: r.dataUrl,
        mime: r.mime || guessMimeFromDataUrl(r.dataUrl),
        isSwatch: !!(r.isSwatch || (r.name && String(r.name).startsWith('swatch:'))),
      }));
  }

  function persistRefImages() {
    commitActiveRefImages(state.refImages || []);
    const base = normalizeRefImages(state.baseRefImages);
    const workflow = normalizeRefImages(state.workflowRefImages);
    Promise.all([
      saveRefImageList(BASE_REF_IMAGES_LS_KEY, base, MAX_REF_IMAGES),
      saveRefImageList(WORKFLOW_REF_IMAGES_LS_KEY, workflow, MAX_REF_IMAGES),
    ]).catch(() => {});
    try {
      localStorage.removeItem(REF_IMAGES_LS_KEY);
      localStorage.removeItem(BASE_REF_IMAGES_LS_KEY);
      localStorage.removeItem(WORKFLOW_REF_IMAGES_LS_KEY);
      localStorage.removeItem(REF_IMAGE_LS_KEY);
      localStorage.removeItem(REF_IMAGE_NAME_LS_KEY);
    } catch (_e) {}
  }

  async function restoreRefImages() {
    try {
      const parseList = (key) => {
        const raw = localStorage.getItem(key);
        if (!raw) return [];
        return normalizeRefImages(JSON.parse(raw));
      };
      state.baseRefImages = await loadRefImageList(BASE_REF_IMAGES_LS_KEY, MAX_REF_IMAGES);
      state.workflowRefImages = await loadRefImageList(WORKFLOW_REF_IMAGES_LS_KEY, MAX_REF_IMAGES);

      if (!state.baseRefImages.length && !state.workflowRefImages.length) {
        let legacy = [];
        const legacyBase = parseList(BASE_REF_IMAGES_LS_KEY);
        const legacyWorkflow = parseList(WORKFLOW_REF_IMAGES_LS_KEY);
        if (legacyBase.length || legacyWorkflow.length) {
          state.baseRefImages = legacyBase;
          state.workflowRefImages = legacyWorkflow;
        }
        const rawMulti = localStorage.getItem(REF_IMAGES_LS_KEY);
        if (!state.baseRefImages.length && !state.workflowRefImages.length) {
          if (rawMulti) legacy = normalizeRefImages(JSON.parse(rawMulti));
          const single = localStorage.getItem(REF_IMAGE_LS_KEY);
          if (!legacy.length && single) {
            legacy = normalizeRefImages([{
              name: localStorage.getItem(REF_IMAGE_NAME_LS_KEY) || 'image',
              dataUrl: single,
              mime: guessMimeFromDataUrl(single),
            }]);
          }
          // Legacy uploads used to be mostly workflow product references; keep
          // them away from the base modes so 文生图/图生图/局部重绘 start clean.
          state.workflowRefImages = legacy;
        }
      }
      syncActiveRefImages();
      persistRefImages();
    } catch (_e) { /* ignore */ }
  }

  function guessMimeFromDataUrl(dataUrl) {
    const m = /^data:([^;,]+)/.exec(String(dataUrl || ''));
    return m ? m[1] : 'image/png';
  }

  function renderRefGrid() {
    syncActiveRefImages();
    const grid = $('#refGrid');
    const count = $('#refCount');
    const box = $('#refUploadBox');
    const addMore = $('#addMoreRefBtn');
    const clearAll = $('#clearAllRefBtn');
    const styleStrength = $('#styleStrength');
    if (!grid) return;
    const items = state.refImages || [];
    if (count) count.textContent = `(${items.length}/${MAX_REF_IMAGES})`;
    if (items.length === 0) {
      grid.hidden = true;
      grid.innerHTML = '';
      if (box) box.style.display = '';
      if (addMore) addMore.hidden = true;
      if (clearAll) clearAll.hidden = true;
      if (styleStrength) styleStrength.style.display = 'none';
      return;
    }
    grid.hidden = false;
    if (box) box.style.display = 'none';
    if (addMore) addMore.hidden = items.length >= MAX_REF_IMAGES;
    if (clearAll) clearAll.hidden = false;
    if (styleStrength) styleStrength.style.display = '';
    grid.innerHTML = items.map((it, idx) => (
      `<div class="ref-card${it.isSwatch ? ' is-swatch' : ''}" data-ref-index="${idx}">`
      + `<span class="ref-card-index">#${idx + 1}</span>`
      + (it.isSwatch ? `<span class="ref-card-tag" title="自动生成的色号样板图">色号</span>` : '')
      + `<button class="ref-card-remove" type="button" aria-label="删除" data-remove-index="${idx}">×</button>`
      + `<img src="${it.dataUrl}" alt="${escapeAttr(it.name || '')}" />`
      + `<div class="ref-card-name">${escapeAttr(it.name || '')}</div>`
      + `</div>`
    )).join('');
  }

  function escapeAttr(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function appendRefFiles(files) {
    if (!files || !files.length) return;
    syncActiveRefImages();
    const room = MAX_REF_IMAGES - state.refImages.length;
    const list = Array.from(files).slice(0, Math.max(0, room));
    let pending = list.length;
    if (!pending) return;
    list.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        state.refImages.push({
          name: file.name,
          dataUrl: ev.target.result,
          mime: file.type || guessMimeFromDataUrl(ev.target.result),
        });
        pending -= 1;
        if (pending === 0) {
          // Keep legacy first-image field in sync.
          commitActiveRefImages(state.refImages);
          renderRefGrid();
          persistRefImages();
        }
      };
      reader.onerror = () => { pending -= 1; };
      reader.readAsDataURL(file);
    });
  }

  function initRefUpload() {
    const box = $('#refUploadBox');
    const input = $('#refInput');
    const addMore = $('#addMoreRefBtn');
    const clearAll = $('#clearAllRefBtn');
    if (!box || !input) return;

    box.addEventListener('click', () => input.click());
    addMore?.addEventListener('click', () => input.click());

    input.addEventListener('change', (e) => {
      appendRefFiles(e.target.files);
      // Reset so the same file can be re-selected.
      e.target.value = '';
    });

    // Drag-and-drop (visual nicety; multi-file is already supported by appendRefFiles).
    ['dragenter', 'dragover'].forEach((evt) => {
      box.addEventListener(evt, (e) => { e.preventDefault(); box.style.borderColor = 'var(--primary)'; });
    });
    ['dragleave', 'drop'].forEach((evt) => {
      box.addEventListener(evt, (e) => { e.preventDefault(); box.style.borderColor = ''; });
    });
    box.addEventListener('drop', (e) => {
      const files = e.dataTransfer?.files;
      if (files?.length) appendRefFiles(files);
    });

    // Remove a single image
    const grid = $('#refGrid');
    grid?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-index]');
      if (!btn) return;
      const idx = Number(btn.dataset.removeIndex);
      if (Number.isNaN(idx)) return;
      syncActiveRefImages();
      state.refImages.splice(idx, 1);
      commitActiveRefImages(state.refImages);
      renderRefGrid();
      persistRefImages();
      // If we removed the swatch and the prompt was set to the multi-image
      // wording, refresh the prompt so it doesn't lie about figure 2.
      try { syncWorkflowPrompt(); } catch (_e) {}
    });

    // Clear all
    clearAll?.addEventListener('click', () => {
      syncActiveRefImages();
      state.refImages = [];
      commitActiveRefImages(state.refImages);
      renderRefGrid();
      persistRefImages();
      try { syncWorkflowPrompt(); } catch (_e) {}
    });

    // Restore persisted refs asynchronously; IndexedDB is used to avoid
    // localStorage quota failures with multi-image uploads.
    restoreRefImages().finally(renderRefGrid);
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
        state.workflowMode = false;
        $$('.workflow-tab').forEach((b) => b.classList.remove('active'));
        $$('.mode-tab').forEach((b) => b.classList.remove('active'));
        $$('.mode-tab[data-mode="inpaint"]')[0].classList.add('active');
        state.mode = 'inpaint';
        if (actionToPrompt[action]) {
          $('#promptInput').value = actionToPrompt[action];
          persistBasePrompt();
        }
        updateModeUI();
        updateWorkflowPanelVisibility();
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
    if (!hint) return;
    if (state.mode === 'inpaint') {
      hint.textContent = state.workflowMode ? '开始处理' : '蒙版重绘';
      return;
    }
    hint.textContent = state.count + ' 张图';
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
      modelName = provider ? getProviderModelForMode(provider, state.mode) : (defaultImage.provider === state.model ? defaultImage.model : '');
    } catch (e) { /* ignore */ }
    node.classList.toggle('ready', hasKey);
    node.classList.toggle('missing', !hasKey);
    const configuredModel = provider && provider.model ? provider.model : modelName;
    const displayModel = modelName;
    const modeSuffix = hasKey && state.mode !== 'txt2img' && configuredModel && displayModel !== configuredModel ? '（图生图使用）' : '';
    node.querySelector('span').textContent = hasKey
      ? `当前模型：${modelLabel} · ${displayModel || '默认模型'}${modeSuffix}`
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
    if (state.workflowMode) syncWorkflowPrompt();
    syncActiveRefImages();
    const prompt = state.workflowMode ? buildWorkflowPrompt().trim() : $('#promptInput').value.trim();
    if (!prompt && state.mode !== 'inpaint') {
      alert('请输入图片描述');
      return;
    }
    if (state.mode === 'img2img' && !(state.refImages && state.refImages.length)) {
      alert('请先上传参考图');
      return;
    }
    if (state.workflowMode && getActiveWorkflowKey() === 'apply' && !getProductRefImages().length) {
      alert('请先上传商品图，再应用色号或图案。色号样板图不能单独作为商品图生成。');
      return;
    }
    if (state.mode === 'inpaint' && !state.results.length) {
      alert('请先上传需要局部重绘的图片');
      return;
    }

    // Read API config from settings, resolve provider + model from active chip
    const { activeProvider, activeModel, providerConfig } = resolveActiveImageConfig();
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
    state.results = [];
    state.currentIndex = -1;
    $('#emptyState').style.display = 'none';
    $('#previewWrap').style.display = 'none';
    $('#resultGrid').style.display = 'none';
    $('#resultGrid').innerHTML = '';
    $('#genLoading').style.display = '';
    $('#progressBar').style.width = '10%';
    const targetCount = (state.mode === 'inpaint' || (state.workflowMode && getActiveWorkflowKey() === 'variants'))
      ? 1
      : Math.max(1, state.count || 1);
    const historyPrompt = state.workflowMode ? getWorkflowHistoryLabel() : prompt;
    const loadingText = $('#loadingText');
    const updateProgressText = (index) => {
      if (!loadingText) return;
      loadingText.textContent = targetCount > 1 ? `AI 创作中...第 ${index + 1}/${targetCount} 张` : 'AI 创作中...';
    };

    // 模拟进度
    let progress = 10;
    const progressTimer = setInterval(() => {
      progress = Math.min(progress + Math.random() * 15, 90);
      $('#progressBar').style.width = progress + '%';
    }, 800);

    try {
      for (let i = 0; i < targetCount; i += 1) {
        updateProgressText(i);
        if (i > 0) renderResults(state.results, { pending: true, pendingIndex: i, total: targetCount });
        const results = await generateWithConfiguredApi({
          provider: activeProvider,
          model: activeModel,
          endpoint: providerConfig.api_base || providerConfig.endpoint,
          key: providerConfig.key,
          prompt,
          count: 1,
        });

        results.forEach((r) => { r.prompt = historyPrompt; });
        $('#genLoading').style.display = 'none';
        const mergedResults = state.results.concat(results);
        const hasMore = i + 1 < targetCount;
        renderResults(mergedResults, hasMore ? { pending: true, pendingIndex: i + 1, total: targetCount } : {});
        saveToHistory(results, historyPrompt);
        $('#progressBar').style.width = Math.round(((i + 1) / targetCount) * 100) + '%';
      }

      clearInterval(progressTimer);
      $('#progressBar').style.width = '100%';
      $('#genLoading').style.display = 'none';
    } catch (err) {
      clearInterval(progressTimer);
      restoreGenerationSurface();
      toast('生成失败：' + err.message, 6000);
      alert('生成失败：' + err.message);
    } finally {
      state.generating = false;
      $('#genBtn').disabled = false;
      $('#genBtn').classList.remove('generating');
      if (loadingText) loadingText.textContent = 'AI 创作中...';
    }
  }

  function restoreGenerationSurface() {
    $('#genLoading').style.display = 'none';
    if (state.results.length) {
      renderResults(state.results);
      return;
    }
    $('#resultGrid').style.display = 'none';
    $('#previewWrap').style.display = 'none';
    $('#emptyState').style.display = '';
  }

  // ========== 结果渲染 ==========
  function renderResults(results, options = {}) {
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
        <img src="${escapeAttr(r.url)}" alt="结果${i + 1}" />
        <div class="result-actions">
          <button data-action="upscale" title="打开大图预览">查看大图</button>
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
      item.querySelector('[data-action="save"]').addEventListener('click', () => {
        saveToHistory([r], r.prompt || getCurrentPromptLabel('保存结果'));
        toast('已保存到素材库');
      });
      item.querySelector('[data-action="download"]').addEventListener('click', () => {
        downloadImage(r.url, imageFilename('nextgen', r.url));
      });
      grid.appendChild(item);
    });
    if (options.pending) {
      const pending = document.createElement('div');
      pending.className = 'result-item result-pending';
      pending.innerHTML = `
        <div class="result-pending-body">
          <div class="result-pending-spinner"></div>
          <div class="result-pending-title">正在生成第 ${options.pendingIndex + 1}/${options.total} 张</div>
          <div class="result-pending-sub">已生成的图片可以先查看，剩余结果会自动追加</div>
        </div>
      `;
      grid.appendChild(pending);
    }
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

  function toast(message, duration = 1600) {
    let node = document.querySelector('.editor-toast');
    if (!node) {
      node = document.createElement('div');
      node.className = 'editor-toast';
      document.body.appendChild(node);
    }
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(node._timer);
    node._timer = setTimeout(() => node.classList.remove('show'), duration);
  }

  function imageFilename(prefix, url) {
    let ext = 'png';
    const mime = /^data:image\/([^;,]+)/i.exec(String(url || ''));
    if (mime && mime[1]) {
      ext = mime[1].toLowerCase() === 'jpeg' ? 'jpg' : mime[1].toLowerCase();
    } else {
      const pathExt = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(String(url || ''));
      if (pathExt && ['png', 'jpg', 'jpeg', 'webp'].includes(pathExt[1].toLowerCase())) {
        ext = pathExt[1].toLowerCase() === 'jpeg' ? 'jpg' : pathExt[1].toLowerCase();
      }
    }
    return `${prefix}-${Date.now()}.${ext}`;
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
    const refInput = $('#refInput');
    const getUploadTarget = () => {
      const activeTab = document.querySelector('.tab-btn.active');
      if (activeTab && activeTab.dataset.tab === 'edit') return 'canvas';
      if (state.workflowMode) return null;
      if (state.mode === 'inpaint') return 'canvas';
      if (state.mode === 'img2img') return 'ref';
      return null;
    };

    emptyState.addEventListener('click', (e) => {
      const target = getUploadTarget();
      if (target === 'canvas') input.click();
      if (target === 'ref') refInput?.click();
    });
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (getUploadTarget()) {
        emptyState.classList.add('dragover');
      }
    });
    container.addEventListener('dragleave', () => {
      emptyState.classList.remove('dragover');
    });
    container.addEventListener('drop', (e) => {
      e.preventDefault();
      emptyState.classList.remove('dragover');
      const target = getUploadTarget();
      if (target === 'canvas') {
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) loadImageToCanvas(file);
      } else if (target === 'ref') {
        const files = Array.from(e.dataTransfer.files || []).filter((file) => file.type.startsWith('image/'));
        if (files.length) appendRefFiles(files);
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
      if (current) downloadImage(current.url, imageFilename('nextgen-adjusted', current.url));
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
        downloadImage(state.modalImageUrl, imageFilename('nextgen', state.modalImageUrl));
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

    results.forEach((r) => {
      addAsset({ type: 'image', url: r.url, label: prompt || '图片调整' });
    });

    renderHistory();
  }

  function renderHistory() {
    const list = $('#historyList');
    list.innerHTML = '';
    state.history.slice(0, 20).forEach((h, i) => {
      const item = document.createElement('div');
      item.className = 'history-item';
      item.innerHTML = `
        <img src="${escapeAttr(h.url)}" alt="历史${i + 1}" />
        <div class="history-item-info">
          <div class="history-prompt">${escapeAttr(h.prompt)}</div>
          <div class="history-time">${escapeAttr(h.time)}</div>
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
