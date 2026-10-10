import {Slot} from '@radix-ui/react-slot';
import {cva,type VariantProps} from 'class-variance-authority';
import {clsx} from 'clsx';
import {twMerge} from 'tailwind-merge';
import type {ComponentProps} from 'react';
const styles=cva('button',{variants:{variant:{default:'primary',outline:'outline',ghost:'ghost'}},defaultVariants:{variant:'default'}});
export function Button({className,variant,asChild=false,...props}:ComponentProps<'button'>&VariantProps<typeof styles>&{asChild?:boolean}){const C=asChild?Slot:'button';return <C className={twMerge(clsx(styles({variant}),className))} {...props}/>;}
