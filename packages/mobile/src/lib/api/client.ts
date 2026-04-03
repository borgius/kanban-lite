import type {
  JsonObject,
  JsonValue,
  MobileCardStateCursor,
  MobileCardStateMutation,
  MobileChecklistReadModel,
  MobileCommentReadModel,
  MobileTaskDetail,
  MobileTaskListItem,
} from './contracts'

export type {
  JsonObject,
  JsonValue,
  MobileCardStateCursor,
  MobileCardStateMutation,
  MobileChecklistReadModel,
  MobileCommentReadModel,
  MobileTaskDetail,
  MobileTaskListItem,
  MobileTaskPermissions,
  MobileResolvedFormDescriptor,
} from './contracts'

export interface MobileApiClientOptions {
  workspaceOrigin: string
  token: string
  fetchImplementation?: typeof fetch
}

export interface AttachmentUploadInput {
  files: Array<{
    name: string
    data: string
  }>
}

export interface ChecklistAddInput {
  text: string
  expectedToken: string
}

export interface ChecklistPatchInput {
  expectedRaw?: string | null
  text?: string | null
}

export interface CommentCreateInput {
  author: string
  content: string
}

export interface CommentUpdateInput {
  content: string
}

export type CommentDeleteResult = JsonObject & {
  deleted: boolean
}

export interface FormSubmitInput {
  data: JsonValue
}

export interface MobileApiClient {
  listTasks(query?: Record<string, boolean | number | string | undefined>): Promise<MobileTaskListItem[]>
  getTask(taskId: string): Promise<MobileTaskDetail>
  markTaskOpened(taskId: string): Promise<MobileCardStateMutation>
  markTaskRead(taskId: string, input?: { readThrough?: MobileCardStateCursor }): Promise<MobileCardStateMutation>
  listComments(taskId: string): Promise<MobileCommentReadModel[]>
  createComment(taskId: string, input: CommentCreateInput): Promise<MobileCommentReadModel>
  updateComment(taskId: string, commentId: string, input: CommentUpdateInput): Promise<MobileCommentReadModel>
  deleteComment(taskId: string, commentId: string): Promise<CommentDeleteResult>
  uploadAttachments(taskId: string, input: AttachmentUploadInput): Promise<JsonObject>
  attachmentUrl(taskId: string, filename: string, options?: { download?: boolean }): string
  removeAttachment(taskId: string, filename: string): Promise<JsonObject>
  getChecklist(taskId: string): Promise<MobileChecklistReadModel>
  addChecklistItem(taskId: string, input: ChecklistAddInput): Promise<MobileChecklistReadModel>
  editChecklistItem(taskId: string, index: number, input: ChecklistPatchInput): Promise<MobileChecklistReadModel>
  deleteChecklistItem(taskId: string, index: number, input?: { expectedRaw?: string | null }): Promise<MobileChecklistReadModel>
  checkChecklistItem(taskId: string, index: number, input?: { expectedRaw?: string | null }): Promise<MobileChecklistReadModel>
  uncheckChecklistItem(taskId: string, index: number, input?: { expectedRaw?: string | null }): Promise<MobileChecklistReadModel>
  submitForm(taskId: string, formId: string, input: FormSubmitInput): Promise<JsonObject>
  triggerAction(taskId: string, action: string): Promise<void>
}

interface ApiEnvelope<T extends JsonValue> {
  ok?: boolean
  data?: T
  error?: string
}

export class MobileApiClientError extends Error {
  public readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'MobileApiClientError'
    this.status = status
  }
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resolveFetchImplementation(fetchImplementation?: typeof fetch): typeof fetch {
  if (typeof fetchImplementation === 'function') {
    return fetchImplementation
  }

  if (typeof fetch === 'function') {
    return fetch
  }

  throw new Error('Fetch is not available in this runtime.')
}

function resolveWorkspaceBaseUrl(workspaceOrigin: string): URL {
  let parsed: URL

  try {
    parsed = new URL(workspaceOrigin.trim())
  } catch {
    throw new MobileApiClientError(400, 'ERR_MOBILE_WORKSPACE_UNRESOLVED')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new MobileApiClientError(400, 'ERR_MOBILE_WORKSPACE_UNRESOLVED')
  }

  return new URL(parsed.origin)
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value)
}

function applyQuery(
  url: URL,
  query?: Record<string, boolean | number | string | undefined>,
): void {
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) {
      continue
    }

    url.searchParams.set(key, String(value))
  }
}

async function readEnvelope<T extends JsonValue>(response: Response): Promise<ApiEnvelope<T> | null> {
  const text = await response.text()
  if (text.length === 0) {
    return null
  }

  let parsed: JsonValue
  try {
    parsed = JSON.parse(text) as JsonValue
  } catch {
    throw new MobileApiClientError(response.status, 'Invalid JSON response from mobile API.')
  }

  if (!isJsonObject(parsed)) {
    throw new MobileApiClientError(response.status, 'Invalid mobile API response payload.')
  }

  return parsed as ApiEnvelope<T>
}

async function requestJson<T extends JsonValue>(
  fetchImplementation: typeof fetch,
  token: string,
  url: URL,
  init: Omit<RequestInit, 'body'> & { body?: JsonValue },
): Promise<T> {
  const hasBody = init.body !== undefined
  const response = await fetchImplementation(url.toString(), {
    ...init,
    body: hasBody ? JSON.stringify(init.body) : undefined,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })
  const envelope = await readEnvelope<T>(response)

  if (!response.ok) {
    throw new MobileApiClientError(response.status, envelope?.error ?? response.statusText)
  }

  if (!envelope || envelope.ok !== true || envelope.data === undefined) {
    throw new MobileApiClientError(response.status, 'Invalid mobile API response payload.')
  }

  return envelope.data
}

async function requestNoContent(
  fetchImplementation: typeof fetch,
  token: string,
  url: URL,
  init: RequestInit,
): Promise<void> {
  const response = await fetchImplementation(url.toString(), {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  })

  if (response.ok) {
    return
  }

  const envelope = await readEnvelope<JsonObject>(response)
  throw new MobileApiClientError(response.status, envelope?.error ?? response.statusText)
}

function createTaskUrl(baseUrl: URL, taskId: string, suffix?: string): URL {
  const pathSuffix = suffix ? `/${suffix}` : ''
  return new URL(`/api/tasks/${encodeSegment(taskId)}${pathSuffix}`, baseUrl)
}

export function createMobileApiClient(options: MobileApiClientOptions): MobileApiClient {
  const fetchImplementation = resolveFetchImplementation(options.fetchImplementation)
  const token = options.token.trim()
  const baseUrl = resolveWorkspaceBaseUrl(options.workspaceOrigin)

  if (token.length === 0) {
    throw new MobileApiClientError(401, 'ERR_MOBILE_SESSION_REQUIRED')
  }

  return {
    async listTasks(query) {
      const url = new URL('/api/tasks', baseUrl)
      applyQuery(url, query)
      return requestJson<MobileTaskListItem[]>(fetchImplementation, token, url, {
        method: 'GET',
      })
    },

    async getTask(taskId) {
      return requestJson<MobileTaskDetail>(fetchImplementation, token, createTaskUrl(baseUrl, taskId), {
        method: 'GET',
      })
    },

    async markTaskOpened(taskId) {
      return requestJson<MobileCardStateMutation>(fetchImplementation, token, createTaskUrl(baseUrl, taskId, 'open'), {
        method: 'POST',
      })
    },

    async markTaskRead(taskId, input) {
      return requestJson<MobileCardStateMutation>(fetchImplementation, token, createTaskUrl(baseUrl, taskId, 'read'), {
        method: 'POST',
        body: input?.readThrough ? { readThrough: input.readThrough } : {},
      })
    },

    async listComments(taskId) {
      return requestJson<MobileCommentReadModel[]>(
        fetchImplementation,
        token,
        createTaskUrl(baseUrl, taskId, 'comments'),
        {
          method: 'GET',
        },
      )
    },

    async createComment(taskId, input) {
      return requestJson<MobileCommentReadModel>(
        fetchImplementation,
        token,
        createTaskUrl(baseUrl, taskId, 'comments'),
        {
          method: 'POST',
          body: {
            author: input.author,
            content: input.content,
          },
        },
      )
    },

    async updateComment(taskId, commentId, input) {
      return requestJson<MobileCommentReadModel>(
        fetchImplementation,
        token,
        createTaskUrl(baseUrl, taskId, `comments/${encodeSegment(commentId)}`),
        {
          method: 'PUT',
          body: {
            content: input.content,
          },
        },
      )
    },

    async deleteComment(taskId, commentId) {
      return requestJson<CommentDeleteResult>(
        fetchImplementation,
        token,
        createTaskUrl(baseUrl, taskId, `comments/${encodeSegment(commentId)}`),
        {
          method: 'DELETE',
        },
      )
    },

    async uploadAttachments(taskId, input) {
      return requestJson<JsonObject>(
        fetchImplementation,
        token,
        createTaskUrl(baseUrl, taskId, 'attachments'),
        {
          method: 'POST',
          body: {
            files: input.files.map((file) => ({
              name: file.name,
              data: file.data,
            })),
          },
        },
      )
    },

    attachmentUrl(taskId, filename, options) {
      const url = createTaskUrl(
        baseUrl,
        taskId,
        `attachments/${encodeSegment(filename)}`,
      )
      if (options?.download) {
        url.searchParams.set('download', '1')
      }
      return url.toString()
    },

    async removeAttachment(taskId, filename) {
      return requestJson<JsonObject>(
        fetchImplementation,
        token,
        createTaskUrl(baseUrl, taskId, `attachments/${encodeSegment(filename)}`),
        {
          method: 'DELETE',
        },
      )
    },

    async getChecklist(taskId) {
      return requestJson<MobileChecklistReadModel>(
        fetchImplementation,
        token,
        createTaskUrl(baseUrl, taskId, 'checklist'),
        {
          method: 'GET',
        },
      )
    },

    async addChecklistItem(taskId, input) {
      return requestJson<MobileChecklistReadModel>(
        fetchImplementation,
        token,
        createTaskUrl(baseUrl, taskId, 'checklist'),
        {
          method: 'POST',
          body: {
            text: input.text,
            expectedToken: input.expectedToken,
          },
        },
      )
    },

    async editChecklistItem(taskId, index, input) {
      return requestJson<MobileChecklistReadModel>(
        fetchImplementation,
        token,
        createTaskUrl(baseUrl, taskId, `checklist/${index}`),
        {
          method: 'PUT',
          body: {
            text: input.text ?? '',
            expectedRaw: input.expectedRaw ?? undefined,
          },
        },
      )
    },

    async deleteChecklistItem(taskId, index, input) {
      return requestJson<MobileChecklistReadModel>(
        fetchImplementation,
        token,
        createTaskUrl(baseUrl, taskId, `checklist/${index}`),
        {
          method: 'DELETE',
          body: {
            expectedRaw: input?.expectedRaw ?? undefined,
          },
        },
      )
    },

    async checkChecklistItem(taskId, index, input) {
      return requestJson<MobileChecklistReadModel>(
        fetchImplementation,
        token,
        createTaskUrl(baseUrl, taskId, `checklist/${index}/check`),
        {
          method: 'POST',
          body: {
            expectedRaw: input?.expectedRaw ?? undefined,
          },
        },
      )
    },

    async uncheckChecklistItem(taskId, index, input) {
      return requestJson<MobileChecklistReadModel>(
        fetchImplementation,
        token,
        createTaskUrl(baseUrl, taskId, `checklist/${index}/uncheck`),
        {
          method: 'POST',
          body: {
            expectedRaw: input?.expectedRaw ?? undefined,
          },
        },
      )
    },

    async submitForm(taskId, formId, input) {
      return requestJson<JsonObject>(
        fetchImplementation,
        token,
        createTaskUrl(baseUrl, taskId, `forms/${encodeSegment(formId)}/submit`),
        {
          method: 'POST',
          body: {
            data: input.data,
          },
        },
      )
    },

    async triggerAction(taskId, action) {
      await requestNoContent(
        fetchImplementation,
        token,
        createTaskUrl(baseUrl, taskId, `actions/${encodeSegment(action)}`),
        {
          method: 'POST',
        },
      )
    },
  }
}
