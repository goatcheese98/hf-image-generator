import {defineConfig} from "vite"

export default defineConfig({
	plugins: [
		
	],
	base: '/hf-image-generator/',
	build: {
		outDir: 'dist',
		assetsDir: 'assets'
	}
})