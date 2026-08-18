import { useRef } from "react"
import { Camera, Upload } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@food/components/ui/dialog"
import { openCamera, openGallery } from "@food/utils/imageUploadUtils"
import { compressImageForUpload } from "@/shared/utils/imageCompressor"

/**
 * ImageSourcePicker component to choose between Camera and Gallery
 * This shows a dialog in-app and handles the selection
 */
export const ImageSourcePicker = ({ 
  isOpen, 
  onClose, 
  onFileSelect, 
  title = "Update photo",
  description = "Choose how you want to upload your photo.",
  fileNamePrefix = "upload",
  galleryInputRef = null
}) => {
  const internalInputRef = useRef(null)
  
  const handleOpenCamera = async () => {
    try {
      onClose()
      await openCamera({
        onSelectFile: onFileSelect,
        fileNamePrefix: fileNamePrefix
      })
    } catch (error) {
      console.error("Camera error caught in ImageSourcePicker:", error)
      // Silently fail - toast already shown in openCamera function
    }
  }

  const handlePickFromDevice = async () => {
    try {
      onClose()
      await openGallery({
        onSelectFile: onFileSelect,
        fileNamePrefix,
        fallbackInputRef: galleryInputRef || internalInputRef,
      })
    } catch (error) {
      console.error("Gallery error caught in ImageSourcePicker:", error)
      // Silently fail - toast already shown if needed
    }
  }

  // If no bridge is available, we might not even need the dialog if we want to default to gallery
  // But usually users might still want a camera option if their browser supports it.

  return (
    <>
      <input 
        type="file" 
        ref={internalInputRef} 
        style={{ display: 'none' }} 
        accept="image/*" 
        onChange={async (e) => {
          const file = e.target.files?.[0]
          if (file && onFileSelect) {
            try {
              const compressed = await compressImageForUpload(file)
              onFileSelect(compressed)
            } catch {
              onFileSelect(file)
            }
          }
          e.target.value = ""
        }} 
      />
      <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-sm w-[calc(100%-2rem)] rounded-2xl p-0 overflow-hidden">
        <DialogHeader className="p-5 pb-3">
          <DialogTitle className="text-lg font-bold text-gray-900">{title}</DialogTitle>
          <DialogDescription className="text-sm text-gray-500">
            {description}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 px-5 pb-5">
          <button
            type="button"
            onClick={handleOpenCamera}
            className="w-full p-3 rounded-xl border-2 border-gray-200 bg-white hover:border-gray-300 transition-all flex items-center justify-between group active:scale-[0.98]"
          >
            <span className="font-medium text-sm text-gray-900">Use Camera</span>
            <div className="p-2 rounded-lg bg-orange-50 group-hover:bg-orange-100 transition-colors">
              <Camera className="h-5 w-5 text-orange-600" />
            </div>
          </button>
          <button
            type="button"
            onClick={handlePickFromDevice}
            className="w-full p-3 rounded-xl border-2 border-gray-200 bg-white hover:border-gray-300 transition-all flex items-center justify-between group active:scale-[0.98]"
          >
            <span className="font-medium text-sm text-gray-900">Upload from Device</span>
            <div className="p-2 rounded-lg bg-blue-50 group-hover:bg-blue-100 transition-colors">
              <Upload className="h-5 w-5 text-blue-600" />
            </div>
          </button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  )
}
