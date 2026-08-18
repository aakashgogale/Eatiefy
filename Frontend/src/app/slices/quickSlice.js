import { createSlice } from '@reduxjs/toolkit'

const initialState = {
  initialized: false,
}

const quickSlice = createSlice({
  name: 'quick',
  initialState,
  reducers: {
    setInitialized(state, action) {
      state.initialized = action.payload ?? true
    },
  },
})

export const { setInitialized } = quickSlice.actions
export default quickSlice.reducer
