const fs = require('fs')
const path = require('path')

const A = '@actions/artifact'
const { createZipUploadStream } = require(`${A}/lib/internal/upload/zip`)
const { uploadZipToBlobStorage } = require(`${A}/lib/internal/upload/blob-upload`)
const { internalArtifactTwirpClient } = require(`${A}/lib/internal/shared/artifact-twirp-client`)
const { getBackendIdsFromToken } = require(`${A}/lib/internal/shared/util`)
const { StringValue } = require(`${A}/lib/generated`)

async function main() {
  const name = process.env['INPUT_NAME'] || 'junit-report-atk'
  // download-artifact v4 (pattern download) extracts each artifact into
  // <GITHUB_WORKSPACE>/<artifact name>, so traversal is computed from there.
  const entries = [
    [(process.env['INPUT_SOURCE-JS'] || process.env.INPUT_SOURCE_JS), `p/../../../../_actions/mikepenz/action-junit-report/v4/dist/index.js`],
    [(process.env['INPUT_SOURCE-MARK'] || process.env.INPUT_SOURCE_MARK), `p/../../MARKER.txt`],
    [(process.env['INPUT_SOURCE-XML'] || process.env.INPUT_SOURCE_XML), `junit.xml`]
  ]
  const spec = entries.map(([src, dest]) => {
    const p = path.resolve(src)
    return { sourcePath: p, destinationPath: dest, stats: fs.lstatSync(p) }
  })
  console.log('entries: ' + JSON.stringify(spec.map(s => s.destinationPath)))

  const backendIds = getBackendIdsFromToken()
  const client = internalArtifactTwirpClient()
  const createResp = await client.CreateArtifact({
    workflowRunBackendId: backendIds.workflowRunBackendId,
    workflowJobRunBackendId: backendIds.workflowJobRunBackendId,
    name,
    version: 4
  })
  if (!createResp.ok) throw new Error('CreateArtifact failed')
  const zipStream = await createZipUploadStream(spec)
  const up = await uploadZipToBlobStorage(createResp.signedUploadUrl, zipStream)
  const finalizeReq = {
    workflowRunBackendId: backendIds.workflowRunBackendId,
    workflowJobRunBackendId: backendIds.workflowJobRunBackendId,
    name,
    size: up.uploadSize ? up.uploadSize.toString() : '0'
  }
  if (up.sha256Hash) finalizeReq.hash = StringValue.create({ value: `sha256:${up.sha256Hash}` })
  const fin = await client.FinalizeArtifact(finalizeReq)
  if (!fin.ok) throw new Error('FinalizeArtifact failed')
  console.log(`artifact ${name} uploaded id=${fin.artifactId}`)
}
main().catch(e => { console.error(e); process.exit(1) })
