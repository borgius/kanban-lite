declare module 'jsdoc-to-markdown' {
  interface RenderOptions {
    files?: string | string[]
    source?: string
    data?: object[]
    template?: string
    configure?: string
    [key: string]: unknown
  }
  const jsdoc2md: {
    render(options: RenderOptions): Promise<string>
    renderSync(options: RenderOptions): string
    getTemplateData(options: RenderOptions): Promise<object[]>
    getTemplateDataSync(options: RenderOptions): object[]
  }
  export default jsdoc2md
}
