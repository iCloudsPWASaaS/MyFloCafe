'use client';

import { useCallback, useState, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import Cropper, { type Area } from 'react-easy-crop';
import { Camera, Link, Upload, X, Check, Search, Loader2 } from 'lucide-react';
import { compressCroppedImage, MAX_RAW_FILE_SIZE } from '@/lib/image-utils';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { useTranslations } from 'use-intl';

interface SearchImageResult {
  source: string;
  title: string;
  thumbnail: string | null;
  full: string | null;
  width: number | null;
  height: number | null;
  context_url: string | null;
}

interface ImageUploaderProps {
  /** Current Base64 data URI (or null if no image) */
  value: string | null;
  /** Called when image changes (Base64 data URI) or is cleared (null) */
  onChange: (value: string | null) => void;
  /** Product ID for URL proxy fetch */
  productId?: string;
  /** Prefill for the online image search (usually the product name) */
  initialQuery?: string;
}

// Number of search results shown in the picker grid (thumbnails are proxied
// one-by-one, so cap keeps the preview fast).
const SEARCH_RESULT_LIMIT = 12;

type Mode = 'idle' | 'cropping' | 'url-input' | 'search';

export default function ImageUploader({ value, onChange, productId, initialQuery }: ImageUploaderProps) {
  const t = useTranslations('products');
  const tCommon = useTranslations('common');
  const [mode, setMode] = useState<Mode>('idle');
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [aspect] = useState(1); // Always 1:1
  const [urlInput, setUrlInput] = useState('');
  const [fetching, setFetching] = useState(false);
  const [searchQuery, setSearchQuery] = useState(() => initialQuery ?? '');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchImageResult[] | null>(null);
  const [searchError, setSearchError] = useState(false);
  const [thumbData, setThumbData] = useState<Record<number, string>>({});
  const searchSeqRef = useRef(0);
  
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const cropAreaRef = useRef<{ x: number; y: number; width: number; height: number }>({ x: 0, y: 0, width: 0, height: 0 });
  // Cache-busting query param for the existing-image URL below. Lazy-initialized once per
  // mount (the form modal remounts this component each time it opens) instead of calling
  // Date.now() directly during render, which would refetch the image on every re-render.
  const [cacheBust] = useState(() => Date.now());

  const processFile = useCallback(async (file: File) => {
    if (file.size > MAX_RAW_FILE_SIZE) {
      toast.error(t('imageTooLarge', { size: MAX_RAW_FILE_SIZE / 1024 / 1024 }));
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error(t('imageSelectFile'));
      return;
    }

    // Load into crop editor
    const reader = new FileReader();
    reader.onload = () => {
      setCropSrc(reader.result as string);
      setMode('cropping');
      setCrop({ x: 0, y: 0 });
      setZoom(1);
    };
    reader.onerror = () => {
      toast.error(t('imageReadFailed'));
    };
    reader.readAsDataURL(file);
  }, [t]);

  const handleCropComplete = useCallback((_croppedArea: Area, croppedAreaPixels: Area) => {
    cropAreaRef.current = {
      x: croppedAreaPixels.x,
      y: croppedAreaPixels.y,
      width: croppedAreaPixels.width,
      height: croppedAreaPixels.height,
    };
  }, []);

  const handleCropSave = useCallback(async () => {
    if (!cropSrc) return;

    try {
      const img = new Image();
      img.src = cropSrc;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image for cropping'));
      });

      // Use the actual pixel coordinates from react-easy-crop, or fall back to full natural size
      const width = cropAreaRef.current.width || img.width;
      const height = cropAreaRef.current.height || img.height;
      const x = cropAreaRef.current.x || 0;
      const y = cropAreaRef.current.y || 0;

      const dataUri = compressCroppedImage(img, { x, y, width, height });
      if (!dataUri) {
        toast.error(t('imageCompressFailed'));
        return;
      }

      onChange(dataUri);
      setMode('idle');
      setCropSrc(null);
      toast.success(t('imageReady'));
    } catch {
      toast.error(t('imageCropFailed'));
      setMode('idle');
      setCropSrc(null);
    }
  }, [cropSrc, onChange, t]);

  const handleUrlFetch = useCallback(async () => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    if (!trimmed.toLowerCase().startsWith('https://')) {
      toast.error(t('imageHttpsOnly'));
      return;
    }
    setFetching(true);

    try {
      const res = await api.post('/products/fetch-url', { url: trimmed });
      const dataUri = res.data.data;

      if (!dataUri) {
        toast.error(t('imageFetchFailed'));
        return;
      }

      // Load into crop editor
      setCropSrc(dataUri);
      setMode('cropping');
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setUrlInput('');
    } catch {
      toast.error(t('imageFetchFailed'));
    } finally {
      setFetching(false);
    }
  }, [urlInput, t]);

  // The products page CSP only allows images from 'self' and data: URIs, so
  // SerpAPI's remote thumbnails can't be loaded directly in <img> tags. Each
  // thumbnail is instead pulled through the existing SSRF-guarded, role-protected
  // /fetch-url proxy (which converts to a Base64 data URI) and rendered locally.
  // Cap at SEARCH_RESULT_LIMIT and fetch concurrently to keep the grid fast.
  const prefetchThumbnails = useCallback(async (results: SearchImageResult[], seq: number) => {
    const slice = results.slice(0, SEARCH_RESULT_LIMIT);
    let cursor = 0;
    const worker = async () => {
      while (cursor < slice.length) {
        const i = cursor++;
        const item = slice[i];
        if (!item.thumbnail) continue;
        try {
          const res = await api.post('/products/fetch-url', { url: item.thumbnail });
          const uri = res.data.data as string | undefined;
          // Ignore results from a superseded search (seq mismatch).
          if (uri && searchSeqRef.current === seq) setThumbData((prev) => ({ ...prev, [i]: uri }));
        } catch {
          // Leave the tile as a placeholder; the result is still clickable.
        }
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
  }, []);

  const handleSearch = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) return;
    const seq = ++searchSeqRef.current;
    setSearching(true);
    setSearchError(false);
    setThumbData({});

    try {
      const res = await api.get('/products/image-search', { params: { q: query } });
      const results = res.data.results ?? [];
      setSearchResults(results);
      prefetchThumbnails(results, seq);
    } catch {
      setSearchResults([]);
      setSearchError(true);
    } finally {
      setSearching(false);
    }
  }, [searchQuery, prefetchThumbnails]);

  // Reuse the existing SSRF-guarded proxy: fetch the chosen external image,
  // then run it through the same crop → compress pipeline as a local upload.
  const handleUseSearchResult = useCallback(async (result: SearchImageResult) => {
    if (!result.full) return;
    setFetching(true);
    try {
      const res = await api.post('/products/fetch-url', { url: result.full });
      const dataUri = res.data.data;
      if (!dataUri) {
        toast.error(t('imageFetchFailed'));
        return;
      }
      setCropSrc(dataUri);
      setMode('cropping');
      setCrop({ x: 0, y: 0 });
      setZoom(1);
    } catch {
      toast.error(t('imageFetchFailed'));
    } finally {
      setFetching(false);
    }
  }, [t]);

  const handleRemove = useCallback(() => {
    onChange(null);
    setMode('idle');
    setCropSrc(null);
  }, [onChange]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      processFile(acceptedFiles[0]);
    }
  }, [processFile]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    maxFiles: 1,
    noClick: false,
    noKeyboard: false,
  });

  // ── Crop modal ──────────────────────────────────────────────────────
  if (mode === 'cropping' && cropSrc) {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
        <div className="bg-card rounded-2xl max-w-lg w-full overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h3 className="font-semibold text-foreground">{t('cropImage')}</h3>
            <button type="button" onClick={() => { setMode('idle'); setCropSrc(null); }} className="text-gray-400 hover:text-muted-foreground">
              <X size={20} />
            </button>
          </div>
          <div className="relative w-full aspect-square bg-muted">
            <Cropper
              image={cropSrc}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={handleCropComplete}
            />
          </div>
          <div className="px-4 py-3 border-t flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={3}
              step={0.1}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1"
            />
            <button type="button"
              onClick={handleCropSave}
              className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-lg hover:bg-brand/90 transition-colors"
            >
              <Check size={16} />
{t('imageCropApply')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── URL input mode ──────────────────────────────────────────────────
  if (mode === 'url-input') {
    return (
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://example.com/photo.jpg"
            className="flex-1 px-3 py-2 border border-border rounded-lg text-sm focus:border-brand outline-none"
            dir="ltr"
            onKeyDown={(e) => e.key === 'Enter' && handleUrlFetch()}
          />
          <button type="button"
            onClick={handleUrlFetch}
            disabled={fetching || !urlInput.trim()}
            className="px-3 py-2 bg-brand text-white rounded-lg text-sm hover:bg-brand/90 disabled:opacity-50"
          >
            {fetching ? t('imageFetching') : t('imageFetch')}
          </button>
          <button type="button"
            onClick={() => { setMode('idle'); setUrlInput(''); }}
            className="px-3 py-2 text-muted-foreground hover:text-foreground text-sm"
          >
            {tCommon('cancel')}
          </button>
        </div>
        <p className="text-xs text-gray-400">{t('imageUrlHint')}</p>
      </div>
    );
  }

  // ── Online image search mode ─────────────────────────────────────────
  if (mode === 'search') {
    return (
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="font-semibold text-foreground text-sm">{t('imageSearchTitle')}</h3>
          <button type="button"
            onClick={() => { setMode('idle'); setSearchResults(null); setSearchError(false); setThumbData({}); }}
            className="text-gray-400 hover:text-muted-foreground"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('imageSearchPlaceholder')}
            className="flex-1 px-3 py-2 border border-border rounded-lg text-sm focus:border-brand outline-none"
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button type="button"
            onClick={handleSearch}
            disabled={searching || !searchQuery.trim()}
            className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-lg text-sm hover:bg-brand/90 disabled:opacity-50"
          >
            {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            {searching ? t('imageSearching') : t('imageSearchBtn')}
          </button>
        </div>
        <p className="text-xs text-gray-400">{t('imageSearchHint')}</p>

        {searchResults === null && !searching && (
          <div className="text-center py-6 text-muted-foreground text-sm">
            <Search size={28} className="mx-auto mb-2 opacity-40" />
            <p>{t('imageSearchIdle')}</p>
          </div>
        )}

        {searching && (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Loader2 size={28} className="animate-spin mb-2" />
            <p className="text-sm">{t('imageSearching')}</p>
          </div>
        )}

        {!searching && searchResults !== null && searchResults.length === 0 && (
          <div className="text-center py-6 text-muted-foreground text-sm">
            <p>{searchError ? t('imageSearchFailed') : t('imageSearchEmpty')}</p>
          </div>
        )}

        {!searching && (searchResults ?? []).length > 0 && (
          <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto">
            {(searchResults ?? []).slice(0, SEARCH_RESULT_LIMIT).map((result, index) => (
              <button
                key={`${result.full ?? ''}-${index}`}
                type="button"
                onClick={() => handleUseSearchResult(result)}
                disabled={fetching}
                title={result.title || t('imageSearchUse')}
                className="group relative aspect-square rounded-lg overflow-hidden border border-border bg-muted hover:border-brand transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {thumbData[index] ? (
                  <img
                    src={thumbData[index]}
                    alt={result.title || t('imageSearchUse')}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                  />
                ) : (
                  <span className="flex items-center justify-center w-full h-full text-muted-foreground">
                    <Loader2 size={16} className="animate-spin" />
                  </span>
                )}
                <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-xs font-medium transition-opacity">
                  {fetching ? t('imageFetching') : t('imageSearchUse')}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Idle mode — show current image or upload controls ────────────────
  const previewUrl = value === 'EXISTING' && productId
    ? `${api.defaults.baseURL}/products/${productId}/image?t=${cacheBust}`
    : (value !== 'EXISTING' ? value : null);

  return (
    <div className="space-y-2">
      {/* Current image preview */}
      {previewUrl && (
        <div className="relative w-24 h-24 rounded-lg overflow-hidden border border-border">
          <img src={previewUrl} alt="Product" className="w-full h-full object-cover" />
          <button type="button"
            onClick={handleRemove}
            className="absolute top-1 end-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Upload controls */}
      <div className="space-y-3">
        {/* Large File drop zone */}
        <div
          {...getRootProps()}
          className={`w-full flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
            isDragActive ? 'border-brand bg-brand/5 text-brand' : 'border-gray-300 dark:border-border text-muted-foreground hover:border-brand hover:bg-muted'
          }`}
        >
          <input {...getInputProps()} />
          <Upload size={24} className="mb-2 text-gray-400" />
          <p className="text-sm font-medium text-center">
            {isDragActive ? t('imageDropActive') : t('imageDropIdle')}
          </p>
        </div>

        <div className="flex items-center gap-2 justify-center">
          <div className="flex-1 h-px bg-gray-200 dark:bg-border"></div>
          <span className="text-xs text-gray-400 font-medium uppercase px-2">{t('imageOrUse')}</span>
          <div className="flex-1 h-px bg-gray-200 dark:bg-border"></div>
        </div>

        <div className="flex flex-wrap gap-2 justify-center">
          {/* Camera button (tablet POS) */}
          <button type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm text-foreground hover:bg-muted hover:border-gray-400 dark:border-border dark:hover:border-border transition-colors"
          >
            <Camera size={16} />
            {t('imageCamera')}
          </button>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) processFile(file);
              e.target.value = '';
            }}
          />

          {/* URL paste */}
          <button type="button"
            onClick={() => setMode('url-input')}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm text-foreground hover:bg-muted hover:border-gray-400 dark:border-border dark:hover:border-border transition-colors"
          >
            <Link size={16} />
            {t('imagePasteUrl')}
          </button>

          {/* Online image search */}
          <button type="button"
            onClick={() => { setMode('search'); setSearchResults(null); setSearchError(false); setThumbData({}); }}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm text-foreground hover:bg-muted hover:border-gray-400 dark:border-border dark:hover:border-border transition-colors"
          >
            <Search size={16} />
            {t('imageSearch')}
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-400 text-center mt-4">
        {t('imageMaxSize', { size: MAX_RAW_FILE_SIZE / 1024 / 1024 })}
      </p>
    </div>
  );
}
