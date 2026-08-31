import { useRef } from "react"
import { Camera, Upload } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@food/components/ui/dialog"
import { compressImageForUpload } from "@/shared/utils/imageCompressor"

/**
 * ImageSourcePicker component to choose between Camera and Gallery.
 * Directly triggers trusted synchronous DOM input clicks to guarantee 
 * 100% compatibility across iOS Safari, WKWebView, Android, and desktop browsers.
 */
export const ImageSourcePicker = ({ 
  isOpen, 
  onClose, 
  onFileSelect, 
  title = "Add Photo",
  description = "Choose how you want to upload your photo.",
  galleryInputRef = null
}) => {
  const cameraInputRef = useRef(null)
  const internalGalleryInputRef = useRef(null)

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (file && typeof onFileSelect === "function") {
      try {
        const compressed = await compressImageForUpload(file)
        onFileSelect(compressed)
      } catch {
        onFileSelect(file)
      }
    }
    e.target.value = ""
    if (typeof onClose === "function") {
      onClose()
    }
  }

  const handleCameraClick = () => {
    if (cameraInputRef.current) {
      cameraInputRef.current.click()
    }
    if (typeof onClose === "function") {
      onClose()
    }
  }

  const handleGalleryClick = () => {
    if (galleryInputRef?.current) {
      galleryInputRef.current.click()
    } else if (internalGalleryInputRef.current) {
      internalGalleryInputRef.current.click()
    }
    if (typeof onClose === "function") {
      onClose()
    }
  }

  return (
    <>
      {/* Direct synchronous camera input */}
      <input 
        type="file" 
        ref={cameraInputRef} 
        style={{ display: 'none' }} 
        accept="image/*,.jpg,.jpeg,.png,.webp,.heic,.heif" 
        capture="environment"
        onChange={handleFileChange} 
      />

      {/* Direct synchronous gallery / file input */}
      <input 
        type="file" 
        ref={internalGalleryInputRef} 
        style={{ display: 'none' }} 
        accept="image/*,.jpg,.jpeg,.png,.webp,.heic,.heif" 
        onChange={handleFileChange} 
      />

      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-sm w-[calc(100%-2rem)] rounded-2xl p-0 overflow-hidden bg-white shadow-2xl border border-gray-200">
          <DialogHeader className="p-5 pb-3">
            <DialogTitle className="text-lg font-bold text-gray-900">{title}</DialogTitle>
            <DialogDescription className="text-sm text-gray-500">
              {description}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-5 pb-5">
            <button
              type="button"
              onClick={handleCameraClick}
              className="w-full p-3.5 rounded-xl border-2 border-gray-200 bg-white hover:border-[#00B761] hover:bg-emerald-50/40 transition-all flex items-center justify-between group active:scale-[0.98] cursor-pointer shadow-xs"
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-100 text-[#00B761] group-hover:scale-105 transition-transform">
                  <Camera className="h-5 w-5" />
                </div>
                <div className="text-left">
                  <p className="font-bold text-sm text-gray-900">Take Photo</p>
                  <p className="text-xs text-gray-500">Use device camera</p>
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={handleGalleryClick}
              className="w-full p-3.5 rounded-xl border-2 border-gray-200 bg-white hover:border-blue-500 hover:bg-blue-50/40 transition-all flex items-center justify-between group active:scale-[0.98] cursor-pointer shadow-xs"
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-blue-100 text-blue-600 group-hover:scale-105 transition-transform">
                  <Upload className="h-5 w-5" />
                </div>
                <div className="text-left">
                  <p className="font-bold text-sm text-gray-900">Choose from Gallery</p>
                  <p className="text-xs text-gray-500">Select image from device</p>
                </div>
              </div>
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
