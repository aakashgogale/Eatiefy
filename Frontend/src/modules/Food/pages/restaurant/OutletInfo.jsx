import { useState, useEffect, useRef } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import useRestaurantBackNavigation from "@food/hooks/useRestaurantBackNavigation"
import { motion, AnimatePresence } from "framer-motion"
import Lenis from "lenis"
import {
  ArrowLeft,
  Edit,
  Pencil,
  Plus,
  MapPin,
  Clock,
  Star,
  ChevronRight,
  X,
  Trash2,
  Phone,
  CreditCard,
  Calendar,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@food/components/ui/dialog"
import { Button } from "@food/components/ui/button"
import { Input } from "@food/components/ui/input"
import { restaurantAPI } from "@food/api"
import { formatRestaurantDisplayAddress } from "@food/utils/restaurantLocation"
import { toast } from "sonner"
import { ImageSourcePicker } from "@food/components/ImageSourcePicker"
import { isFlutterBridgeAvailable, convertBase64ToFile } from "@food/utils/imageUploadUtils"
import BottomNavOrders from "@food/components/restaurant/BottomNavOrders"

const debugLog = (...args) => {}
const debugWarn = (...args) => {}
const debugError = (...args) => {}


const CUISINES_STORAGE_KEY = "restaurant_cuisines"

// Helper component for reusable action buttons
const ActionButton = ({ icon: Icon, label, onClick }) => (
  <button 
    onClick={onClick}
    className="w-full flex items-center justify-between p-4 bg-white rounded-2xl border border-gray-100 hover:border-[#B80B3D]/30 hover:bg-gradient-to-br from-[#B80B3D] to-[#66001D]/5 transition-all active:scale-[0.98] shadow-sm"
  >
    <div className="flex items-center gap-4">
      <div className="bg-gradient-to-br from-[#B80B3D] to-[#66001D]/5 p-2.5 rounded-xl">
        <Icon className="w-5 h-5 text-[#B80B3D]" />
      </div>
      <span className="text-[15px] font-bold text-gray-800 tracking-tight">{label}</span>
    </div>
    <ChevronRight className="w-5 h-5 text-gray-300" />
  </button>
)

export default function OutletInfo() {
  const navigate = useNavigate()
  const location = useLocation()
  const goBack = useRestaurantBackNavigation()
  
  // State management
  const [restaurantData, setRestaurantData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [restaurantName, setRestaurantName] = useState("")
  const [cuisineTags, setCuisineTags] = useState("")
  const [address, setAddress] = useState("")
  const [mainImage, setMainImage] = useState("https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&h=400&fit=crop")
  const [thumbnailImage, setThumbnailImage] = useState("https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=200&h=200&fit=crop")
  const [coverImages, setCoverImages] = useState([]) // Array of cover images (separate from menu images)
  const [showEditNameDialog, setShowEditNameDialog] = useState(false)
  const [editNameValue, setEditNameValue] = useState("")
  const [restaurantId, setRestaurantId] = useState("")
  const [restaurantMongoId, setRestaurantMongoId] = useState("")
  const [uploadingImage, setUploadingImage] = useState(false)
  const [imageType, setImageType] = useState(null) // 'profile' or 'menu'
  const [uploadingCount, setUploadingCount] = useState(0) // Track how many images are being uploaded
  
  const profileImageInputRef = useRef(null)
  const menuImageInputRef = useRef(null)
  const [activePicker, setActivePicker] = useState(null) // { type: 'profile' | 'cover', ref: any, title: string, multiple: boolean }

  // Fetch restaurant data on mount and whenever this page is opened again
  useEffect(() => {
    const applyRestaurantData = (data) => {
      if (!data) return

      setRestaurantData(data)
      setRestaurantName(data.name || "")
      setRestaurantId(data.restaurantId || data.id || "")
      setRestaurantMongoId(String(data.id || data._id || ""))
      setAddress(formatRestaurantDisplayAddress(data.location, data))

      if (data.cuisines && Array.isArray(data.cuisines) && data.cuisines.length > 0) {
        setCuisineTags(data.cuisines.join(", "))
      }

      if (data.profileImage?.url) {
        setThumbnailImage(data.profileImage.url)
      }

      if (data.coverImages && Array.isArray(data.coverImages) && data.coverImages.length > 0) {
        setCoverImages(data.coverImages.map(img => ({
          url: img.url || img,
          publicId: img.publicId
        })))
        setMainImage(data.coverImages[0].url || data.coverImages[0])
      } else if (data.menuImages && Array.isArray(data.menuImages) && data.menuImages.length > 0) {
        setCoverImages(data.menuImages.map(img => ({
          url: img.url,
          publicId: img.publicId
        })))
        setMainImage(data.menuImages[0].url)
      } else {
        setCoverImages([])
      }
    }

    const fetchRestaurantData = async () => {
      try {
        setLoading(true)
        const response = await restaurantAPI.refreshCurrentRestaurant()
        const data = response?.data?.data?.restaurant || response?.data?.restaurant
        applyRestaurantData(data)
      } catch (error) {
        if (error.code !== 'ERR_NETWORK' && error.code !== 'ECONNABORTED' && !error.message?.includes('timeout')) {
          debugError("Error fetching restaurant data:", error)
        }
      } finally {
        setLoading(false)
      }
    }

    const savedLocation = location.state?.savedLocation
    if (savedLocation) {
      setAddress(formatRestaurantDisplayAddress(savedLocation))
    }

    fetchRestaurantData()

    const handleRestaurantDataUpdate = () => {
      fetchRestaurantData()
    }

    window.addEventListener("cuisinesUpdated", handleRestaurantDataUpdate)
    window.addEventListener("addressUpdated", handleRestaurantDataUpdate)
    window.addEventListener("ownerDataUpdated", handleRestaurantDataUpdate)
    
    return () => {
      window.removeEventListener("cuisinesUpdated", handleRestaurantDataUpdate)
      window.removeEventListener("addressUpdated", handleRestaurantDataUpdate)
      window.removeEventListener("ownerDataUpdated", handleRestaurantDataUpdate)
    }
  }, [location.pathname, location.state?.savedLocation])

  // Lenis smooth scrolling
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
    })

    function raf(time) {
      lenis.raf(time)
      requestAnimationFrame(raf)
    }

    requestAnimationFrame(raf)

    return () => {
      lenis.destroy()
    }
  }, [])

  // Handle profile image replacement
  const handleProfileImageReplace = async (file) => {
    if (!file) return

    try {
      setUploadingImage(true)
      setImageType('profile')

      // Upload image to the server (/var/www/uploads as WebP)
      const uploadResponse = await restaurantAPI.uploadProfileImage(file)
      const uploadedImage = uploadResponse?.data?.data?.profileImage

      if (uploadedImage) {
        if (uploadedImage.url) {
          setThumbnailImage(uploadedImage.url)
        }
        
        // Refresh restaurant data
        const response = await restaurantAPI.getCurrentRestaurant()
        const data = response?.data?.data?.restaurant || response?.data?.restaurant
        if (data) {
          setRestaurantData(data)
          if (data.profileImage?.url) {
            setThumbnailImage(data.profileImage.url)
          }
        }
      }
    } catch (error) {
      debugError("Error uploading profile image:", error)
      toast.error("Failed to upload image. Please try again.")
    } finally {
      setUploadingImage(false)
      setImageType(null)
    }
  }

  // Handle multiple cover images addition
  const handleCoverImageAdd = async (files) => {
    if (!files || (Array.isArray(files) && files.length === 0)) return
    const fileArray = Array.isArray(files) ? files : [files]

    try {
      setUploadingImage(true)
      setImageType('menu')
      setUploadingCount(fileArray.length)

      // Get current images
      const currentResponse = await restaurantAPI.getCurrentRestaurant()
      const currentData = currentResponse?.data?.data?.restaurant || currentResponse?.data?.restaurant
      const existingImages = currentData?.menuImages && Array.isArray(currentData.menuImages)
        ? currentData.menuImages.map(img => ({
            url: img.url,
            publicId: img.publicId
          }))
        : []

      const uploadedImageData = []
      const failedUploads = []
      
      for (let i = 0; i < fileArray.length; i++) {
        try {
          const uploadResponse = await restaurantAPI.uploadMenuImage(fileArray[i])
          const uploadedImage = uploadResponse?.data?.data?.menuImage
          if (uploadedImage?.url) {
            uploadedImageData.push({
              url: uploadedImage.url,
              publicId: uploadedImage.publicId || null
            })
          }
        } catch (error) {
          failedUploads.push({ fileName: fileArray[i]?.name || "image", error: error.message })
        }
      }

      if (uploadedImageData.length > 0) {
        const allImages = [...existingImages]
        uploadedImageData.forEach(uploaded => {
          if (!allImages.find(img => img.url === uploaded.url)) {
            allImages.push(uploaded)
          }
        })

        try {
          await restaurantAPI.updateProfile({ menuImages: allImages })
          toast.success(`Successfully uploaded ${uploadedImageData.length} image(s)`)
        } catch (updateError) {
          toast.error("Images uploaded but failed to save.")
        }

        setCoverImages(allImages)
        if (allImages.length > 0) setMainImage(allImages[0].url)
      }
    } catch (error) {
      toast.error("Failed to upload images.")
    } finally {
      setUploadingImage(false)
      setImageType(null)
      setUploadingCount(0)
    }
  }

  const handleImageClick = (type, ref, title, multiple = false) => {
    if (isFlutterBridgeAvailable()) {
      setActivePicker({ type, ref, title, multiple })
    } else {
      ref.current?.click()
    }
  }

  // Handle cover image deletion
  const handleCoverImageDelete = async (indexToDelete) => {
    if (!window.confirm("Are you sure you want to delete this cover image?")) return

    try {
      setUploadingImage(true)
      setImageType('menu')

      const updatedImages = coverImages.filter((_, index) => index !== indexToDelete)
      const menuImagesForBackend = updatedImages.map(img => ({
        url: img.url,
        publicId: img.publicId || null
      }))

      await restaurantAPI.updateProfile({ menuImages: menuImagesForBackend })
      setCoverImages(updatedImages)
      if (indexToDelete === 0 && updatedImages.length > 0) {
        setMainImage(updatedImages[0].url)
      } else if (updatedImages.length === 0) {
        setMainImage("https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&h=400&fit=crop")
      }
      toast.success("Image deleted successfully")
    } catch (error) {
      toast.error("Failed to delete image.")
    } finally {
      setUploadingImage(false)
      setImageType(null)
    }
  }

  // Handle edit name dialog
  const handleOpenEditDialog = () => {
    setEditNameValue(restaurantName)
    setShowEditNameDialog(true)
  }

  const handleSaveName = async () => {
    const newName = editNameValue.trim()
    if (!newName) return
    if (/[\/-]/.test(newName)) {
      toast.error("Name cannot contain slashes (/) or hyphens (-)")
      return
    }
    try {
      await restaurantAPI.updateProfile({ name: newName })
      setRestaurantName(newName)
      setShowEditNameDialog(false)
      toast.success("Name updated successfully")
    } catch (error) {
      toast.error("Failed to update name")
    }
  }

  return (
    <>
      <div className="min-h-screen bg-white overflow-x-hidden pb-24">
        {/* Header */}
        <div className="bg-white/80 backdrop-blur-md border-b border-gray-100 px-4 py-3 sticky top-0 z-50 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-1">
              <button 
                onClick={goBack} 
                className="p-2 hover:bg-gradient-to-br from-[#B80B3D] to-[#66001D]/5 rounded-xl transition-all active:scale-95"
              >
                <ArrowLeft className="w-5 h-5 text-[#B80B3D]" />
              </button>
              <h1 className="text-[17px] font-bold text-gray-900 tracking-tight">Outlet Information</h1>
            </div>
            <div className="bg-gradient-to-br from-[#B80B3D] to-[#66001D] px-3 py-1.5 rounded-full shadow-sm">
              <p className="text-[11px] font-black text-white uppercase tracking-wider">
                ID: {loading ? "..." : (restaurantMongoId && restaurantMongoId.length >= 5 ? restaurantMongoId.slice(-5) : (restaurantId || "N/A"))}
              </p>
            </div>
          </div>
        </div>

        {/* Main Image & Profile Section */}
        <div className="px-4 pt-4">
          <div className="relative w-full h-[180px] rounded-[2rem] overflow-hidden shadow-xl ring-1 ring-black/5">
            <img src={mainImage} alt="Restaurant banner" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                        <input
              ref={menuImageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleCoverImageAdd(Array.from(e.target.files || []))}
            />
          </div>

          {/* Profile Overlap & Restaurant Name */}
          <div className="relative z-10 px-4">
            <div className="flex flex-col gap-4">
              {/* Profile Image */}
              <div className="relative -mt-12 group inline-block w-fit">
                <div className="w-24 h-24 rounded-[2rem] bg-white p-1.5 shadow-2xl ring-1 ring-black/5 shrink-0">
                  <img src={thumbnailImage} alt="Restaurant thumbnail" className="w-full h-full rounded-[1.6rem] object-cover" />
                </div>
              </div>

              {/* Restaurant Name & Rating - Below the overlap area for visibility */}
              <div className="pb-1">
                <h2 className="text-2xl font-black text-gray-900 leading-tight">
                  {loading ? "Loading..." : (restaurantName || "My Restaurant")}
                </h2>
                <div className="flex items-center gap-2 mt-2">
                  <div className="bg-green-600 px-2.5 py-1 rounded-lg flex items-center gap-1 shrink-0 shadow-sm">
                    <span className="text-white text-xs font-black">{restaurantData?.rating?.toFixed(1) || "0.0"}</span>
                    <Star className="w-3 h-3 text-white fill-white" />
                  </div>
                  <span className="text-gray-400 text-xs font-bold uppercase tracking-widest">{restaurantData?.totalRatings || 0} Reviews</span>
                </div>
                
                <button
                  onClick={() => navigate("/food/restaurant/edit-owner", { state: { from: location.pathname, activeTab: "restaurant" } })}
                  className="mt-4 bg-gradient-to-br from-[#B80B3D] to-[#66001D] text-white px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-[#B80B3D]/20 active:scale-95 transition-all w-fit"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit Outlet Info
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Info Content Section */}
        <div className="px-5 pt-8 pb-12 space-y-6">
          <div className="space-y-4">


            {/* Restaurant Name Card */}
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-gradient-to-br from-blue-50/40 to-blue-50/80 rounded-[1.5rem] p-5 border border-blue-100/50 shadow-sm relative"
            >
              <p className="text-[10px] text-[#B80B3D] font-black uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-gradient-to-br from-[#B80B3D] to-[#66001D] rounded-full"></span>
                Restaurant Name
              </p>
              <p className="text-lg font-black text-gray-900 group-hover:text-[#B80B3D] transition-colors">
                {loading ? "Loading..." : (restaurantName || "N/A")}
              </p>
            </motion.div>



            {/* Address Card */}
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-gradient-to-br from-gray-50 to-gray-100/50 rounded-[1.5rem] p-5 border border-gray-200/50 shadow-sm relative"
            >
              <p className="text-[10px] text-gray-500 font-black uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-gray-500 rounded-full"></span>
                Location Address
              </p>
              <div className="flex items-start gap-3">
                <div className="bg-white p-2 rounded-xl shadow-sm border border-gray-100 shrink-0">
                  <MapPin className="w-5 h-5 text-[#B80B3D]" />
                </div>
                <p className="text-[15px] font-bold text-gray-700 leading-snug">
                  {loading ? "Loading..." : (address || "No address found")}
                </p>
              </div>
            </motion.div>
          </div>


        </div>
      </div>

      {/* Helper Component for Buttons */}
      <Dialog open={showEditNameDialog} onOpenChange={setShowEditNameDialog}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden rounded-[2.5rem] w-[92%] border-none shadow-2xl">
          <DialogHeader className="p-6 bg-gradient-to-br from-white to-gray-50 border-b border-gray-100">
            <DialogTitle className="text-xl font-black text-gray-900 tracking-tight">Rename Outlet</DialogTitle>
            <DialogDescription className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">Update official restaurant name</DialogDescription>
          </DialogHeader>
          <div className="p-6 space-y-4">
            <div className="relative group">
              <Input 
                value={editNameValue} 
                onChange={(e) => setEditNameValue(e.target.value.replace(/[\/-]/g, ""))} 
                placeholder="Ex: Ometto Express" 
                className="w-full h-14 px-5 rounded-2xl border-2 border-gray-100 focus:border-[#B80B3D] focus:ring-0 transition-all font-bold text-lg bg-gray-50 group-hover:bg-white" 
              />
              <Pencil className="absolute right-5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-300 group-hover:text-[#B80B3D] transition-colors" />
            </div>
            <p className="text-[10px] font-bold text-gray-400 px-1 italic">* This will be visible to all customers on the app.</p>
          </div>
          <DialogFooter className="p-6 bg-gray-50/50 flex flex-row gap-3">
            <Button variant="ghost" onClick={() => setShowEditNameDialog(false)} className="flex-1 h-12 rounded-2xl font-bold text-gray-500">Discard</Button>
            <Button onClick={handleSaveName} disabled={!editNameValue.trim()} className="flex-[2] h-12 bg-gradient-to-br from-[#B80B3D] to-[#66001D] text-white hover:bg-[#6a2f56] rounded-2xl font-bold shadow-lg shadow-[#B80B3D]/20 transition-all active:scale-95 disabled:opacity-50">Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImageSourcePicker
        isOpen={!!activePicker}
        onClose={() => setActivePicker(null)}
        onFileSelect={(file) => {
          if (activePicker?.type === 'profile') {
            handleProfileImageReplace(file)
          } else {
            handleCoverImageAdd(file)
          }
        }}
        title={activePicker?.title}
        description={`Choose how to upload your ${activePicker?.type} photo`}
        fileNamePrefix={`outlet-${activePicker?.type}`}
        galleryInputRef={activePicker?.ref}
      />
      
      <BottomNavOrders activeTabOverride="explore" />
    </>
  )
}







