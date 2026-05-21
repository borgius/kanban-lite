import type {
  components,
  paths as GeneratedStandaloneApiPaths,
} from './generated/standalone-api-paths'

/**
 * OpenAPI-derived path map for the standalone HTTP API.
 */
export type StandaloneApiPaths = GeneratedStandaloneApiPaths

/**
 * OpenAPI-derived component schemas for the standalone HTTP API.
 */
export type StandaloneApiComponents = components

/**
 * Any valid standalone API route template from the generated OpenAPI contract.
 */
export type StandaloneApiPath = keyof StandaloneApiPaths

type HttpMethod = 'get' | 'put' | 'post' | 'delete' | 'patch'
type SuccessStatusCode = 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208

type ExcludeNeverMembers<T> = {
  [K in keyof T as T[K] extends never ? never : K]: T[K]
}

type OperationFor<
  Path extends StandaloneApiPath,
  Method extends StandaloneApiMethod<Path>,
> = ExcludeNeverMembers<StandaloneApiPaths[Path]>[Method]

type ParametersFor<
  Path extends StandaloneApiPath,
  Method extends StandaloneApiMethod<Path>,
> = OperationFor<Path, Method> extends { parameters: infer Parameters }
  ? Parameters
  : never

type SuccessResponseFor<
  Path extends StandaloneApiPath,
  Method extends StandaloneApiMethod<Path>,
> = OperationFor<Path, Method> extends { responses: infer Responses extends Record<PropertyKey, unknown> }
  ? Responses[Extract<keyof Responses, SuccessStatusCode>]
  : never

type RequestBodyContentFor<
  Path extends StandaloneApiPath,
  Method extends StandaloneApiMethod<Path>,
> = OperationFor<Path, Method> extends { requestBody?: infer RequestBody }
  ? RequestBody extends { content: infer Content }
    ? Content
    : never
  : never

type RequestContentTypeFor<
  Path extends StandaloneApiPath,
  Method extends StandaloneApiMethod<Path>,
> = Extract<keyof RequestBodyContentFor<Path, Method>, string>

type ResponseContentFor<
  Path extends StandaloneApiPath,
  Method extends StandaloneApiMethod<Path>,
> = SuccessResponseFor<Path, Method> extends { content?: infer Content }
  ? Content extends Record<string, unknown>
    ? Content[keyof Content]
    : null
  : null

export type StandaloneApiMethod<Path extends StandaloneApiPath> = Extract<
  keyof ExcludeNeverMembers<StandaloneApiPaths[Path]>,
  HttpMethod
>

export type StandaloneApiPathParams<
  Path extends StandaloneApiPath,
  Method extends StandaloneApiMethod<Path>,
> = ParametersFor<Path, Method> extends { path: infer PathParameters }
  ? PathParameters
  : never

export type StandaloneApiQueryParams<
  Path extends StandaloneApiPath,
  Method extends StandaloneApiMethod<Path>,
> = ParametersFor<Path, Method> extends { query: infer QueryParameters }
  ? QueryParameters
  : never

export type StandaloneApiRequestBody<
  Path extends StandaloneApiPath,
  Method extends StandaloneApiMethod<Path>,
  ContentType extends RequestContentTypeFor<Path, Method> = RequestContentTypeFor<Path, Method>,
> = RequestBodyContentFor<Path, Method>[ContentType]

export type StandaloneApiResponse<
  Path extends StandaloneApiPath,
  Method extends StandaloneApiMethod<Path>,
> = ResponseContentFor<Path, Method>

/**
 * Shared options for creating a typed standalone API client.
 */
export interface StandaloneApiClientOptions {
  baseUrl: string
  token?: string
  fetchImplementation?: typeof fetch
}

/**
 * Typed request options for one standalone API operation.
 */
export interface StandaloneApiRequestOptions<
  Path extends StandaloneApiPath,
  Method extends StandaloneApiMethod<Path>,
> {
  path?: StandaloneApiPathParams<Path, Method>
  query?: StandaloneApiQueryParams<Path, Method>
  body?: RequestContentTypeFor<Path, Method> extends never
    ? never
    : StandaloneApiRequestBody<Path, Method>
  contentType?: RequestContentTypeFor<Path, Method>
  headers?: HeadersInit
}

interface ApiEnvelope<T> {
  ok?: boolean
  data?: T
  error?: string
}

export interface StandaloneBinaryResponse {
  data: Uint8Array
  contentType?: string
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

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toErrorMessage(status: number, payload: unknown): string {
  if (isRecord(payload)) {
    if (typeof payload['error'] === 'string') return payload['error']
    if (typeof payload['message'] === 'string') return payload['message']
  }
  return `Remote API error ${status}`
}

function encodePath(pathTemplate: string, pathParams?: Record<string, unknown>): string {
  return pathTemplate.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    if (!pathParams || !(key in pathParams)) {
      throw new Error(`Missing path parameter "${key}" for ${pathTemplate}`)
    }
    return encodeURIComponent(String(pathParams[key]))
  })
}

function appendQuery(url: URL, query?: Record<string, unknown>): void {
  if (!query) return

  for (const [key, rawValue] of Object.entries(query)) {
    if (rawValue === undefined || rawValue === null) continue

    if (Array.isArray(rawValue)) {
      for (const item of rawValue) {
        if (item === undefined || item === null) continue
        url.searchParams.append(key, String(item))
      }
      continue
    }

    url.searchParams.set(key, String(rawValue))
  }
}

/**
 * Build a fully qualified standalone API URL from an OpenAPI path template,
 * typed path parameters, and typed query parameters.
 */
export function buildStandaloneApiUrl<
  Path extends StandaloneApiPath,
  Method extends StandaloneApiMethod<Path>,
>(
  baseUrl: string,
  pathTemplate: Path,
  options: Pick<StandaloneApiRequestOptions<Path, Method>, 'path' | 'query'> = {},
): string {
  const url = new URL(encodePath(pathTemplate, options.path as Record<string, unknown> | undefined), normalizeBaseUrl(baseUrl))
  appendQuery(url, options.query as Record<string, unknown> | undefined)
  return url.toString()
}

/**
 * Create a typed fetch wrapper for the standalone HTTP API.
 *
 * The returned client validates path/method/body/query combinations against
 * the generated OpenAPI contract at compile time, automatically attaches the
 * optional bearer token, and unwraps Kanban Lite's `{ ok, data, error }`
 * response envelopes for successful JSON requests.
 */
export function createStandaloneApiClient(options: StandaloneApiClientOptions) {
  const fetchImplementation = resolveFetchImplementation(options.fetchImplementation)
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const token = options.token?.trim()

  function createHeaders(
    contentType?: string,
    headers?: HeadersInit,
  ): Headers {
    const resolved = new Headers(headers)
    resolved.set('Accept', 'application/json')
    if (token) {
      resolved.set('Authorization', `Bearer ${token}`)
    }
    if (contentType) {
      resolved.set('Content-Type', contentType)
    }
    return resolved
  }

  async function request<
    Path extends StandaloneApiPath,
    Method extends StandaloneApiMethod<Path>,
  >(
    method: Method,
    pathTemplate: Path,
    options: StandaloneApiRequestOptions<Path, Method> = {},
  ): Promise<StandaloneApiResponse<Path, Method>> {
    const contentType = options.contentType ?? 'application/json'
    const hasBody = options.body !== undefined
    const url = buildStandaloneApiUrl<Path, Method>(baseUrl, pathTemplate, options)
    const response = await fetchImplementation(url, {
      method: String(method).toUpperCase(),
      headers: createHeaders(hasBody ? contentType : undefined, options.headers),
      body: !hasBody
        ? undefined
        : contentType === 'application/json'
          ? JSON.stringify(options.body)
          : String(options.body),
    })

    if (response.status === 204) {
      if (!response.ok) {
        throw new Error(`Remote API error ${response.status}`)
      }
      return null as StandaloneApiResponse<Path, Method>
    }

    const text = await response.text()
    const contentTypeHeader = response.headers.get('content-type') ?? ''
    const parsed = text.length === 0
      ? null
      : contentTypeHeader.includes('application/json')
        ? JSON.parse(text) as unknown
        : text

    if (!response.ok) {
      throw new Error(toErrorMessage(response.status, parsed))
    }

    if (isRecord(parsed) && 'ok' in parsed) {
      const envelope = parsed as ApiEnvelope<StandaloneApiResponse<Path, Method>>
      if (envelope.ok !== true) {
        throw new Error(envelope.error ?? `Remote API error ${response.status}`)
      }
      return (envelope.data ?? null) as StandaloneApiResponse<Path, Method>
    }

    return (parsed ?? null) as StandaloneApiResponse<Path, Method>
  }

  async function requestBinary<
    Path extends StandaloneApiPath,
    Method extends StandaloneApiMethod<Path>,
  >(
    method: Method,
    pathTemplate: Path,
    options: Pick<StandaloneApiRequestOptions<Path, Method>, 'headers' | 'path' | 'query'> = {},
  ): Promise<StandaloneBinaryResponse | null> {
    const response = await fetchImplementation(
      buildStandaloneApiUrl<Path, Method>(baseUrl, pathTemplate, options),
      {
        method: String(method).toUpperCase(),
        headers: createHeaders(undefined, options.headers),
      },
    )

    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      const text = await response.text()
      const parsed = text.length === 0 ? null : JSON.parse(text) as unknown
      throw new Error(toErrorMessage(response.status, parsed))
    }

    const contentType = response.headers.get('content-type') ?? undefined
    const buffer = await response.arrayBuffer()
    return {
      data: new Uint8Array(buffer),
      contentType,
    }
  }

  return {
    baseUrl,
    request,
    requestBinary,
    buildUrl<Path extends StandaloneApiPath, Method extends StandaloneApiMethod<Path>>(
      pathTemplate: Path,
      requestOptions: Pick<StandaloneApiRequestOptions<Path, Method>, 'path' | 'query'> = {},
    ): string {
      return buildStandaloneApiUrl<Path, Method>(baseUrl, pathTemplate, requestOptions)
    },
  }
}
