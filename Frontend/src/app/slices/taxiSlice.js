import { createSlice } from '@reduxjs/toolkit'

const initialState = {
  initialized: false,
}

const taxiSlice = createSlice({
  name: 'taxi',
  initialState,
  reducers: {
    setInitialized(state, action) {
      state.initialized = action.payload ?? true
    },
  },
})

export const { setInitialized } = taxiSlice.actions
export default taxiSlice.reducer
