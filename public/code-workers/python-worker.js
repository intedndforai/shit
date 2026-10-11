/**
 * Python code runner for the "Run Python" tool.
 *
 * Lives in public/ because it must be a plain classic worker: Pyodide ships as a
 * UMD build that we pull in with importScripts, and it cannot run through the
 * app bundler. Everything happens on the user's machine -- the interpreter,
 * numpy, pandas and matplotlib are fetched from the Pyodide CDN on first use and
 * then cached by the browser.
 */

const PYODIDE_VERSION = "0.26.4";
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const RESULT_MARKER = "__CONDUIT_RESULT__";
const MAX_FILES = 8;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const PRELUDE = [
  "import os as _conduit_os, sys as _conduit_sys, json as _conduit_json, base64 as _conduit_b64",
  '_CONDUIT_OUT = "/conduit-out"',
  "_conduit_os.makedirs(_CONDUIT_OUT, exist_ok=True)",
  "",
  "def conduit_save(name, data):",
  '    """Write text or bytes to the user-visible output folder."""',
  "    path = _conduit_os.path.join(_CONDUIT_OUT, _conduit_os.path.basename(str(name)))",
  '    mode = "wb" if isinstance(data, (bytes, bytearray)) else "w"',
  "    with open(path, mode) as _handle:",
  "        _handle.write(data)",
  "    print(f\"[saved] {_conduit_os.path.basename(path)}\")",
  "    return path",
].join("\n");

const EPILOGUE = [
  '_conduit_payload = {"figures": [], "files": [], "saved": []}',
  "try:",
  '    if "matplotlib" in _conduit_sys.modules:',
  "        import matplotlib as _conduit_mpl",
  '        _conduit_mpl.use("Agg", force=True)',
  "        import matplotlib.pyplot as _conduit_plt, io as _conduit_io",
  "        for _num in _conduit_plt.get_fignums():",
  "            _buffer = _conduit_io.BytesIO()",
  '            _conduit_plt.figure(_num).savefig(_buffer, format="png", bbox_inches="tight", dpi=144)',
  '            _conduit_payload["figures"].append(_conduit_b64.b64encode(_buffer.getvalue()).decode())',
  '        _conduit_plt.close("all")',
  "except Exception as _conduit_figure_error:",
  '    print(f"[figure capture failed] {_conduit_figure_error}", file=_conduit_sys.stderr)',
  "try:",
  "    for _name in sorted(_conduit_os.listdir(_CONDUIT_OUT)):",
  "        _path = _conduit_os.path.join(_CONDUIT_OUT, _name)",
  "        if not _conduit_os.path.isfile(_path):",
  "            continue",
  "        _size = _conduit_os.path.getsize(_path)",
  "        if _size > 2097152 or len(_conduit_payload[\"files\"]) >= 8:",
  "            continue",
  '        with open(_path, "rb") as _handle:',
  '            _conduit_payload["files"].append(',
  '                {"name": _name, "size": _size, "base64": _conduit_b64.b64encode(_handle.read()).decode()}',
  "            )",
  "except Exception:",
  "    pass",
  `print("\\n" + "${RESULT_MARKER}" + _conduit_json.dumps(_conduit_payload))`,
].join("\n");

/** @type {Promise<any> | null} */
let pyodidePromise = null;
/** @type {Array<{id: string, type: string, text?: string}>} */
let queue = [];
let busy = false;

function report(id, type, payload) {
  self.postMessage({ id, type, ...payload });
}

async function interpreter() {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      report("", "status", { message: `Fetching Python ${PYODIDE_VERSION}…` });
      importScripts(`${PYODIDE_CDN}pyodide.js`);
      const instance = await loadPyodide({ indexURL: PYODIDE_CDN });
      return instance;
    })().catch((error) => {
      pyodidePromise = null;
      throw error;
    });
  }
  return pyodidePromise;
}

async function execute(id, code) {
  const pyodide = await interpreter();
  let pendingLine = "";
  let payload = null;

  const consume = (chunk) => {
    pendingLine += chunk;
    let newline = pendingLine.indexOf("\n");
    while (newline >= 0) {
      const line = pendingLine.slice(0, newline);
      pendingLine = pendingLine.slice(newline + 1);
      if (line.startsWith(RESULT_MARKER)) {
        try {
          payload = JSON.parse(line.slice(RESULT_MARKER.length));
        } catch {
          payload = null;
        }
      } else {
        report(id, "stdout", { text: `${line}\n` });
      }
      newline = pendingLine.indexOf("\n");
    }
  };

  pyodide.setStdout({ batched: consume });
  pyodide.setStderr({ batched: (chunk) => report(id, "stderr", { text: `${chunk}\n` }) });

  report(id, "status", { message: "Resolving imports…" });
  try {
    await pyodide.loadPackagesFromImports(code, {
      messageCallback: (message) => report(id, "status", { message }),
    });
  } catch (error) {
    report(id, "stderr", { text: `Could not load a package: ${String((error && error.message) || error)}\n` });
  }

  let result = "";
  let failure = null;
  try {
    const value = await pyodide.runPythonAsync(`${PRELUDE}\n${code}`);
    result = value === undefined || value === null ? "" : String(value);
  } catch (error) {
    failure = String((error && error.message) || error);
  }

  try {
    await pyodide.runPythonAsync(EPILOGUE);
  } catch {
    /* figure and file capture is best effort */
  }

  if (pendingLine.trim().length) consume("\n");

  report(id, "done", {
    result,
    failure,
    figures: Array.isArray(payload && payload.figures) ? payload.figures : [],
    files: Array.isArray(payload && payload.files)
      ? payload.files.filter((file) => file && typeof file.base64 === "string").slice(0, MAX_FILES)
      : [],
    maxFileBytes: MAX_FILE_BYTES,
  });
}

async function drain() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      const job = queue.shift();
      try {
        await execute(job.id, job.code);
      } catch (error) {
        report(job.id, "error", { message: String((error && error.message) || error) });
      }
    }
  } finally {
    busy = false;
  }
}

self.onmessage = (event) => {
  const data = event.data || {};
  if (data.type === "warmup") {
    interpreter().then(
      () => self.postMessage({ type: "warmup", ok: true }),
      (error) => self.postMessage({ type: "warmup", ok: false, message: String(error && error.message) })
    );
    return;
  }
  if (!data.id || typeof data.code !== "string") return;
  queue.push({ id: data.id, code: data.code });
  drain();
};