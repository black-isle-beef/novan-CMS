/** A file the API sent, with the name it gave it. */
export interface Download {
  blob: Blob;
  filename: string;
}

/** Saves a downloaded file (a CSV export, say) in the browser, as a link to it would. */
export function saveDownload(document: Document, download: Download): void {
  const url = URL.createObjectURL(download.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = download.filename;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
