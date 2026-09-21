const { createElement: h, useState, useEffect, useRef } = require('react')
const { Tag, IconChevronDownOutline14, IconRightUpOutline16 } = require('@deepseek-ai/dsh-client-ui-primitives')
const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store')

// Must equal SETTINGS_NAMESPACE in capital-config/index.js — it is both the card's
// `settings.plugin.item` key and the namespace it reads ref names from (guarded by test).
const NS = 'capital-generation'
const FUYAO_DEFAULT_REF = 'FUYAO_API_KEY'
const ANYSEARCH_DEFAULT_REF = 'ANYSEARCH_API_KEY'
const WIND_DEFAULT_REF = 'WIND_API_KEY'
const DOC_URLS = {
  fuyao: 'https://fuyao.aicubes.cn/docs/',
  anysearch: 'https://www.anysearch.com/docs/auth',
  wind: 'https://market.windalice.com/',
}

const zh = {
  title: 'Capital 模式',
  description: 'Capital Generation 插件中配置服务提供商凭证。',
  fuyaoLabel: 'Fuyao API Key',
  fuyaoHint: '必填。同花顺 Fuyao 结构化数据接口。保存后新 Capital 会话生效。',
  anysearchLabel: 'AnySearch API Key',
  anysearchHint: '必填。AnySearch 网页搜索 / 提取接口。保存后新 Capital 会话生效。',
  windLabel: 'Wind Alice API Key',
  windHint: 'Wind 金融信披类文档检索接口。保存后新 Capital 会话生效。',
  openDocs: '打开接口文档',
  configured: '已配置密钥。',
  notConfigured: '未配置密钥。',
  save: '保存',
  saving: '保存中…',
  discard: '放弃修改',
  unsaved: '未保存',
  readOnly: '当前设置存储为只读。',
  saveFailed: '保存失败，请检查设置存储或稍后重试。',
  expand: '展开',
  collapse: '收起',
}

const en = {
  title: 'Capital mode',
  description: 'Configure service provider credentials.',
  fuyaoLabel: 'Fuyao API Key',
  fuyaoHint: 'Tonghuashun Fuyao structured-data API. Takes effect in new Capital sessions.',
  anysearchLabel: 'AnySearch API Key',
  anysearchHint: 'AnySearch web search / extract interface. Takes effect in new Capital sessions.',
  windLabel: 'Wind Alice API Key',
  windHint: 'Wind financial disclosure document retrieval interface. Takes effect in new Capital sessions.',
  openDocs: 'Open API documentation',
  configured: 'Configured',
  notConfigured: 'Not configured',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  unsaved: 'Unsaved',
  readOnly: 'This settings store is read-only.',
  saveFailed: 'Save failed. Check the settings store and try again.',
  expand: 'Show settings',
  collapse: 'Hide settings',
}

function text(value, fallback) {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function refOf(snapshot, field, fallback) {
  if (field === 'fuyao') return text(snapshot.value?.fuyaoCredentialRef, fallback)
  if (field === 'wind') return text(snapshot.value?.retriever?.windDocs?.credentialRef, fallback)
  return text(snapshot.value?.retriever?.credentialRef, fallback)
}

function installStyles() {
  if (typeof document === 'undefined' || document.querySelector('style[data-capital-config]')) return () => {}
  const style = document.createElement('style')
  style.dataset.capitalConfig = 'true'
  style.textContent = `
    .capital-config-field { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; }
    .capital-config-field + .capital-config-field { border-top: .5px solid var(--dsw-alias-border-l2); }
    .capital-config-head { display: flex; align-items: center; gap: 8px; }
    .capital-config-label-group { min-width: 0; flex: 1; display: inline-flex; align-items: center; gap: 4px; }
    .capital-config-label { min-width: 0; color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 500; line-height: 1.5; }
    .capital-config-doc-link { display: inline-flex; flex: none; align-items: center; color: var(--dsw-alias-label-tertiary); line-height: 1; text-decoration: none; }
    .capital-config-doc-link:hover { color: var(--dsw-alias-brand-primary); }
    .capital-config-doc-link:focus-visible { border-radius: 3px; outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
    .capital-config-badges { display: inline-flex; align-items: center; gap: 8px; }
    .capital-config-input { box-sizing: border-box; width: 100%; height: 34px; border: .5px solid var(--dsw-alias-border-l4); border-radius: 8px; padding: 0 12px; background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 1.5; }
    .capital-config-input:focus-visible { border-color: var(--dsw-alias-brand-primary); outline: none; }
    .capital-config-input:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
    .capital-config-hint { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 1.5; }
    .capital-config-card { border: .5px solid var(--dsw-alias-border-l4); border-radius: 16px; background: var(--dsw-alias-bg-layer-3); list-style: none; transition: border-color .16s, background .16s; }
    .capital-config-card:hover { border-color: var(--dsw-alias-label-dimmed); }
    .capital-config-card-open { border-color: var(--dsw-alias-label-dimmed); background: var(--dsw-alias-bg-layer-2); }
    .capital-config-header { appearance: none; width: 100%; border: 0; border-radius: 12px; padding: 14px 16px; display: flex; align-items: center; gap: 12px; background: transparent; color: inherit; cursor: pointer; font: inherit; text-align: left; }
    .capital-config-header:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
    .capital-config-head-text { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 4px; }
    .capital-config-name { color: var(--dsw-alias-label-primary); font-size: 15px; font-weight: 600; line-height: 1.4; }
    .capital-config-description { color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 1.5; }
    .capital-config-chevron { flex: none; color: var(--dsw-alias-label-tertiary); transition: transform .16s; }
    .capital-config-chevron-open { transform: rotate(180deg); }
    .capital-config-body { margin: 0 16px; padding-bottom: 8px; border-top: .5px solid var(--dsw-alias-border-l2); }
    .capital-config-read-only { margin: 12px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 1.5; }
    .capital-config-footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 12px 0 4px; border-top: .5px solid var(--dsw-alias-border-l2); }
    .capital-config-failed { min-width: 0; flex: 1; margin: 0; color: var(--dsw-alias-label-error); font-size: 12px; line-height: 1.5; }
    .capital-config-discard, .capital-config-save { appearance: none; border: 1px solid transparent; border-radius: 8px; padding: 5px 14px; font: inherit; font-size: 13px; line-height: 1.5; cursor: pointer; }
    .capital-config-discard { border-color: var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-secondary); }
    .capital-config-discard:hover:not(:disabled) { border-color: var(--dsw-alias-label-dimmed); color: var(--dsw-alias-label-primary); }
    .capital-config-save { border: 0; background: var(--dsw-alias-label-primary); color: var(--dsw-alias-label-primary-foreground); }
    .capital-config-discard:disabled, .capital-config-save:disabled { cursor: default; opacity: .5; }
  `
  document.head.appendChild(style)
  return () => style.remove()
}

function StatusTag({ configured, children }) {
  return h(Tag, { tone: configured ? 'neutral' : 'quiet' }, children)
}

function ChevronIcon({ open }) {
  return h(IconChevronDownOutline14, {
    className: `capital-config-chevron${open ? ' capital-config-chevron-open' : ''}`,
  })
}

class CapitalCardController {
  constructor(scope, ctx) {
    this.scope = scope
    this.ctx = ctx
    this.listeners = new Set()
    this.drafts = { fuyao: '', anysearch: '', wind: '' }
    this.status = {
      fuyao: { ref: FUYAO_DEFAULT_REF, configured: false, writable: true },
      anysearch: { ref: ANYSEARCH_DEFAULT_REF, configured: false, writable: true },
      wind: { ref: WIND_DEFAULT_REF, configured: false, writable: true },
    }
    this.saving = false
    this.failed = false
    this.store = createSnapshotStore(this.snapshot())
    this.unsubscribe = this.scope.subscribe(() => {
      this.refreshRefs()
      this.publish()
      this.readCredentials()
    })
    this.refreshRefs()
    this.readCredentials()
  }

  dispose() {
    this.unsubscribe?.()
  }

  snapshot() {
    const settings = this.scope.getSnapshot()
    const fuyao = this.status.fuyao
    const anysearch = this.status.anysearch
    const wind = this.status.wind
    return {
      available: settings.status === 'ready',
      writable: settings.writable,
      saving: this.saving,
      failed: this.failed,
      dirty: this.drafts.fuyao.trim() !== '' || this.drafts.anysearch.trim() !== '' || this.drafts.wind.trim() !== '',
      fuyao: { ...fuyao, draft: this.drafts.fuyao },
      anysearch: { ...anysearch, draft: this.drafts.anysearch },
      wind: { ...wind, draft: this.drafts.wind },
    }
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  publish() {
    this.store.set(this.snapshot())
  }

  refreshRefs() {
    const snapshot = this.scope.getSnapshot()
    const next = {
      fuyao: refOf(snapshot, 'fuyao', FUYAO_DEFAULT_REF),
      anysearch: refOf(snapshot, 'anysearch', ANYSEARCH_DEFAULT_REF),
      wind: refOf(snapshot, 'wind', WIND_DEFAULT_REF),
    }
    for (const field of ['fuyao', 'anysearch', 'wind']) {
      if (this.status[field].ref !== next[field]) {
        this.status[field] = { ref: next[field], configured: false, writable: true }
        this.drafts[field] = ''
      }
    }
  }

  async readCredentials() {
    const refs = [this.status.fuyao.ref, this.status.anysearch.ref, this.status.wind.ref]
    try {
      const response = await this.ctx.remote.credentials.describe(refs)
      if (!response?.ok) return
      if (refs[0] !== this.status.fuyao.ref || refs[1] !== this.status.anysearch.ref || refs[2] !== this.status.wind.ref) return
      const values = response.value ?? {}
      for (const field of ['fuyao', 'anysearch', 'wind']) {
        const current = this.status[field]
        const view = values[current.ref]
        if (view === undefined) continue
        this.status[field] = {
          ref: current.ref,
          configured: view.configured === true,
          writable: view.writable !== false,
        }
      }
      this.publish()
    } catch {
      // The card remains usable; the next credentials event retries the read.
    }
  }

  refresh(ref) {
    if (ref === this.status.fuyao.ref || ref === this.status.anysearch.ref || ref === this.status.wind.ref) this.readCredentials()
  }

  edit(field, value) {
    this.drafts[field] = value
    this.failed = false
    this.publish()
  }

  discard() {
    this.drafts = { fuyao: '', anysearch: '', wind: '' }
    this.failed = false
    this.publish()
  }

  async save() {
    const snapshot = this.scope.getSnapshot()
    const writes = ['fuyao', 'anysearch', 'wind'].filter((field) => this.drafts[field].trim() !== '')
    if (writes.length === 0 || this.saving || snapshot.status !== 'ready' || !snapshot.writable) return
    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    for (const field of writes) {
      try {
        await this.ctx.remote.credentials.set(this.status[field].ref, this.drafts[field].trim())
        await this.readCredentials()
        landed = landed && this.status[field].configured
      } catch {
        landed = false
      }
    }
    if (landed) this.drafts = { fuyao: '', anysearch: '', wind: '' }
    this.saving = false
    this.failed = !landed
    this.publish()
  }

  inject() {
    return {
      hooks: {
        capitalCard: this.store,
      },
      edit: (field, value) => this.edit(field, value),
      save: () => this.save(),
      discard: () => this.discard(),
    }
  }
}

function CredentialField({ id, label, hint, docsUrl, state, disabled, onEdit, t }) {
  return h('div', { className: 'capital-config-field' },
    h('div', { className: 'capital-config-head' },
      h('span', { className: 'capital-config-label-group' },
        h('label', { htmlFor: id, className: 'capital-config-label' }, label),
        h('a', {
          href: docsUrl,
          target: '_blank',
          rel: 'noopener noreferrer',
          className: 'capital-config-doc-link',
          title: t('openDocs'),
          'aria-label': `${label}: ${t('openDocs')}`,
        }, h(IconRightUpOutline16, { 'aria-hidden': true })),
      ),
      h('span', { className: 'capital-config-badges' },
        h(StatusTag, { configured: state.configured }, state.configured ? t('configured') : t('notConfigured')),
      ),
    ),
    h('input', {
      id,
      className: 'capital-config-input',
      type: 'password',
      autoComplete: 'off',
      value: state.draft,
      disabled,
      onChange: (event) => onEdit(event.target.value),
    }),
    h('p', { className: 'capital-config-hint' }, hint),
  )
}

function CapitalCard(props) {
  const t = props.t
  const state = props.useCapitalCard((snapshot) => snapshot)
  const [open, setOpen] = useState(false)
  const saveStarted = useRef(false)
  useEffect(() => {
    if (state.saving) {
      saveStarted.current = true
      return
    }
    if (!saveStarted.current) return
    saveStarted.current = false
    if (!state.dirty && !state.failed) setOpen(false)
  }, [state.dirty, state.failed, state.saving])
  if (!state.available) return null
  const disabled = !state.writable
  const saveDisabled = !state.writable || !state.dirty || state.saving
  return h('li', { className: `capital-config-card${open ? ' capital-config-card-open' : ''}` },
    h('button', {
      type: 'button',
      className: 'capital-config-header',
      'aria-expanded': open,
      'aria-label': `${t(open ? 'collapse' : 'expand')}: ${t('title')}`,
      onClick: () => setOpen(!open),
    },
      h('span', { className: 'capital-config-head-text' },
        h('span', { className: 'capital-config-name' }, t('title')),
        h('span', { className: 'capital-config-description' }, t('description')),
      ),
      state.dirty ? h(StatusTag, { configured: true }, t('unsaved')) : null,
      h(ChevronIcon, { open }),
    ),
    open ? h('div', { className: 'capital-config-body' },
      !state.writable ? h('p', { role: 'status', className: 'capital-config-read-only' }, t('readOnly')) : null,
      h(CredentialField, { id: 'capital-config-fuyao-key', label: t('fuyaoLabel'), hint: t('fuyaoHint'), docsUrl: DOC_URLS.fuyao, state: state.fuyao, disabled: disabled || state.saving || !state.fuyao.writable, onEdit: (value) => props.edit('fuyao', value), t }),
      h(CredentialField, { id: 'capital-config-anysearch-key', label: t('anysearchLabel'), hint: t('anysearchHint'), docsUrl: DOC_URLS.anysearch, state: state.anysearch, disabled: disabled || state.saving || !state.anysearch.writable, onEdit: (value) => props.edit('anysearch', value), t }),
      h(CredentialField, { id: 'capital-config-wind-key', label: t('windLabel'), hint: t('windHint'), docsUrl: DOC_URLS.wind, state: state.wind, disabled: disabled || state.saving || !state.wind.writable, onEdit: (value) => props.edit('wind', value), t }),
      h('div', { className: 'capital-config-footer' },
        state.failed ? h('p', { role: 'status', className: 'capital-config-failed' }, t('saveFailed')) : null,
        h('button', { type: 'button', disabled: !state.dirty || state.saving, onClick: props.discard, className: 'capital-config-discard' }, t('discard')),
        h('button', { type: 'button', disabled: saveDisabled, onClick: props.save, className: 'capital-config-save' }, t(state.saving ? 'saving' : 'save')),
      ),
    ) : null,
  )
}

function apply(ctx) {
  const t = ctx.locale.bind(NS)
  ctx.effect(installStyles, 'capital-config: styles')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'capital-config: locale')
  const scope = ctx.settingsScope.bind({ namespace: NS })
  const controller = new CapitalCardController(scope, ctx)
  ctx.effect(() => () => controller.dispose(), 'capital-config: settings scope subscription')
  ctx.effect(() => ctx.remote.$on('credentials/reference-updated', (ref) => controller.refresh(ref)), 'capital-config: credentials')
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: NS,
    locale: NS,
    inject: () => ({
      ...controller.inject(),
      t,
    }),
  }, CapitalCard))
  ctx.logger?.info?.('capital-config: settings card mounted')
}

exports.name = 'capital-config'
exports.inject = ['slots', 'locale', 'remote', 'remote.credentials', 'settingsScope']
exports.apply = apply
