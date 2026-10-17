// Vitest setup for io: installs the Khronos glTF-Validator (a devDependency) behind `validateGltf`.
import * as gltfValidator from 'gltf-validator';
import { setGltfValidator } from '../src/validate/validate';

setGltfValidator(gltfValidator);
